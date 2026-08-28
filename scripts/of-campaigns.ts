/**
 * Pull the OnlyFans tracking links and per-day earnings, and report what the
 * links say about Reddit. Safe to re-run: links are upserted, and each run adds
 * one reading of the counters.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyApi } from '../src/lib/onlyfans/theonlyapi'
import { syncCampaigns, syncEarningsDays } from '../src/lib/onlyfans/campaigns'

async function main() {
  const api = onlyApi()
  if (!api) {
    console.error('ONLYAPI_KEY / ONLYAPI_CRM_ID not set')
    process.exit(1)
  }

  const links = await syncCampaigns(api)
  console.log(
    `links: ${links.links} across ${links.accounts} OnlyFans accounts — ` +
      `${links.reddit} Reddit, ${links.matched} tied to a Reddit account we hold`,
  )
  for (const e of links.errors) console.log(`  ! ${e}`)

  const earnings = await syncEarningsDays(api)
  console.log(`earnings: ${earnings.rows} account-days`)
  for (const e of earnings.errors) console.log(`  ! ${e}`)

  const reddit = await prisma.ofCampaign.findMany({
    where: { isDeleted: false, OR: [{ redditOverride: true }, { redditOverride: null, isReddit: true }] },
    orderBy: [{ ofUsername: 'asc' }, { subs: 'desc' }],
    select: {
      campaignCode: true, name: true, ofUsername: true, clicks: true, subs: true,
      redditAccount: { select: { username: true, modelLabel: true } },
    },
  })
  console.log(`\nReddit links (lifetime counters):`)
  let model = ''
  for (const c of reddit) {
    if (c.ofUsername !== model) {
      model = c.ofUsername ?? ''
      console.log(`\n  ${model}`)
    }
    const tied = c.redditAccount ? `  ← u/${c.redditAccount.username} (${c.redditAccount.modelLabel})` : ''
    console.log(
      `    c${String(c.campaignCode).padEnd(4)} ${c.name.slice(0, 40).padEnd(42)}` +
        `clicks ${String(c.clicks).padStart(7)}   subs ${String(c.subs).padStart(6)}${tied}`,
    )
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
