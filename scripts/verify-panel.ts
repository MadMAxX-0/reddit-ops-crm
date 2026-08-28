/** Compare our per-link earnings against the OnlyFans panel's own view. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { tracedByCampaign } from '../src/lib/queries/traced-revenue'

async function main() {
  const start = new Date('2026-07-22T00:00:00Z')
  const end = new Date('2026-08-22T00:00:00Z')
  const m = await tracedByCampaign(start, end)
  const links = await prisma.ofCampaign.findMany({
    where: {
      ofUserId: '522436478',
      OR: [{ redditOverride: true }, { redditOverride: null, isReddit: true }],
    },
    select: { id: true, campaignCode: true, name: true },
    orderBy: { subs: 'desc' },
  })
  console.log('Zoe · Reddit links · earnings Jul 22 - Aug 21')
  for (const l of links) {
    const v = m.get(l.id)
    console.log(
      `  c${String(l.campaignCode).padEnd(4)} ${l.name.slice(0, 32).padEnd(34)}` +
        `$${((v?.cents ?? 0) / 100).toFixed(2).padStart(9)}   ${v?.spenders ?? 0} spenders`,
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
