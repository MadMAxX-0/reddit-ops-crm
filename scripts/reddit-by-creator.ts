/** Reddit revenue per creator, split by when the fan arrived. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { tracedRevenue } from '../src/lib/queries/traced-revenue'
import { resolveRange, type RangePreset } from '../src/lib/time'

const money = (c: number) => `$${(c / 100).toFixed(2)}`

async function main() {
  const ws = await prisma.workspace.findFirst({ select: { dayBoundaryTimezone: true } })
  const tz = ws?.dayBoundaryTimezone ?? 'UTC'

  const accounts = await prisma.ofCampaign.groupBy({
    by: ['ofUserId'],
    _max: { ofUsername: true },
  })
  const creators = await prisma.creator.findMany({
    where: { ofUserId: { not: null } },
    select: { ofUserId: true, stageName: true },
  })
  const nameBy = new Map(creators.map((c) => [c.ofUserId!, c.stageName]))

  for (const preset of (process.argv[2]
    ? [process.argv[2]]
    : ['24h', '7d', '30d']) as RangePreset[]) {
    const range = resolveRange(preset, tz)
    console.log(`\n${preset} · ${range.label}`)
    console.log(
      `  ${'creator'.padEnd(14)}${'reddit'.padStart(11)}${'new fans'.padStart(12)}${'returning'.padStart(12)}`,
    )
    const rows = []
    for (const a of accounts) {
      const t = await tracedRevenue(range.start, range.end, { ofUserIds: [a.ofUserId] })
      if (t.redditCents === 0) continue
      rows.push({
        name: nameBy.get(a.ofUserId) ?? a._max.ofUsername ?? a.ofUserId,
        ...t,
      })
    }
    rows.sort((x, y) => y.redditCents - x.redditCents)
    for (const r of rows) {
      console.log(
        `  ${r.name.padEnd(14)}${money(r.redditCents).padStart(11)}` +
          `${money(r.redditNewFanCents).padStart(12)}${money(r.redditReturningFanCents).padStart(12)}`,
      )
    }
    const tot = await tracedRevenue(range.start, range.end)
    console.log(
      `  ${'TOTAL'.padEnd(14)}${money(tot.redditCents).padStart(11)}` +
        `${money(tot.redditNewFanCents).padStart(12)}${money(tot.redditReturningFanCents).padStart(12)}`,
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
