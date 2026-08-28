/**
 * Walk a tracking link's claimers straight from the platform and store them.
 *
 * The platform cache skips the oldest and biggest links, which is where years
 * of Reddit traffic sits, so those have to be fetched deliberately. This spends
 * OnlyFans requests — one per hundred fans — so it names exactly what it will
 * walk before it starts.
 *
 *   npx tsx scripts/of-claims-walk.ts            # every under-covered Reddit link
 *   npx tsx scripts/of-claims-walk.ts <code...>  # named links only
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyApi } from '../src/lib/onlyfans/theonlyapi'

async function main() {
  const api = onlyApi()
  if (!api) {
    console.error('ONLYAPI_KEY / ONLYAPI_CRM_ID not set')
    process.exit(1)
  }
  const only = process.argv.slice(2).map(Number).filter(Number.isFinite)

  const links = await prisma.ofCampaign.findMany({
    where: {
      isDeleted: false,
      OR: [{ redditOverride: true }, { redditOverride: null, isReddit: true }],
      ...(only.length ? { campaignCode: { in: only } } : {}),
    },
    select: {
      id: true,
      ofUserId: true,
      ofUsername: true,
      ofCampaignId: true,
      campaignCode: true,
      name: true,
      subs: true,
      claimersCached: true,
    },
    orderBy: { subs: 'desc' },
  })

  // a link whose cache already holds nearly all its subscribers is left alone
  const todo = links.filter((l) => l.ofCampaignId && l.subs > 0 && l.claimersCached < l.subs * 0.9)
  if (!todo.length) {
    console.log('every Reddit link is already covered — nothing to walk')
    await prisma.$disconnect()
    return
  }

  const pages = todo.reduce((n, l) => n + Math.ceil((l.subs - l.claimersCached) / 100), 0)
  console.log(`walking ${todo.length} link(s), about ${pages} platform requests:`)
  for (const l of todo) {
    console.log(
      `  ${l.ofUsername} c${l.campaignCode} ${l.name} — ${l.subs} subs, ${l.claimersCached} cached`,
    )
  }

  for (const l of todo) {
    process.stdout.write(`\n${l.ofUsername} c${l.campaignCode}: `)
    let claimers
    try {
      claimers = await api.campaignClaimersLive(l.ofUserId, l.ofCampaignId!, (n) =>
        process.stdout.write(`${n} `),
      )
    } catch (err) {
      console.log(`failed — ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    let written = 0
    for (const c of claimers) {
      await prisma.ofFanClaim.upsert({
        where: {
          ofUserId_fanId_campaignId: { ofUserId: l.ofUserId, fanId: c.fanId, campaignId: l.id },
        },
        create: {
          ofUserId: l.ofUserId,
          fanId: c.fanId,
          campaignId: l.id,
          fanUsername: c.fanUsername,
          claimedAt: null,
        },
        update: { fanUsername: c.fanUsername },
      })
      written++
    }
    await prisma.ofCampaign.update({
      where: { id: l.id },
      data: { claimersCached: Math.max(l.claimersCached, written) },
    })
    console.log(`→ ${written} claimers stored`)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
