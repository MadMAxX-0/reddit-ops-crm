/** What the tracking links say Reddit actually earned, per window. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { tracedRevenue } from '../src/lib/queries/traced-revenue'
import { resolveRange, type RangePreset } from '../src/lib/time'

const money = (c: number) => `$${(c / 100).toFixed(2)}`

async function main() {
  const ws = await prisma.workspace.findFirst({ select: { dayBoundaryTimezone: true } })
  const tz = ws?.dayBoundaryTimezone ?? 'UTC'
  for (const preset of ['24h', '7d', '30d'] as RangePreset[]) {
    const r = resolveRange(preset, tz)
    const t = await tracedRevenue(r.start, r.end)
    console.log(
      `${preset.padEnd(4)} ${r.label}\n` +
        `      REDDIT      ${money(t.redditCents)}  (${t.redditTransactions} payments)\n` +
        `        new fans    ${money(t.redditNewFanCents)}  (${t.redditNewFans} fans)\n` +
        `        returning   ${money(t.redditReturningFanCents)}  (${t.redditReturningFans} fans)\n` +
        `      other links ${money(t.otherLinkCents)}\n` +
        `      untraced    ${money(t.untracedCents)}\n` +
        `      total       ${money(t.totalCents)}  ·  traceable ${
          t.coverage == null ? '—' : `${(t.coverage * 100).toFixed(0)}%`
        }`,
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
