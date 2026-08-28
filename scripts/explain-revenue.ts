/** Show, step by step, how the Reddit revenue figure is arrived at. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { resolveRange } from '../src/lib/time'

const money = (c: number) => `$${(c / 100).toFixed(2)}`

async function main() {
  const ws = await prisma.workspace.findFirst({ select: { dayBoundaryTimezone: true } })
  const range = resolveRange('30d', ws?.dayBoundaryTimezone ?? 'UTC')
  console.log(`window: ${range.start.toISOString()} → ${range.end.toISOString()}\n`)

  const rows = await prisma.$queryRaw<
    Array<{ label: string; txs: bigint; fans: bigint; cents: bigint }>
  >`
    WITH tx AS (
      SELECT t.*, EXISTS (
        SELECT 1 FROM "OfFanClaim" fc
        JOIN "OfCampaign" c ON c.id = fc."campaignId"
        WHERE fc."ofUserId" = t."ofUserId" AND fc."fanId" = t."fanId" AND c."trackedInCrm"
      ) AS reddit
      FROM "OfTransaction" t
      WHERE t.ts >= ${range.start} AND t.ts < ${range.end}
    )
    SELECT 'all payments in window' AS label, COUNT(*) AS txs,
           COUNT(DISTINCT "fanId") AS fans, COALESCE(SUM("netCents"),0) AS cents FROM tx
    UNION ALL
    SELECT 'from a fan on a counted link', COUNT(*), COUNT(DISTINCT "fanId"),
           COALESCE(SUM("netCents"),0) FROM tx WHERE reddit
    UNION ALL
    SELECT 'everyone else', COUNT(*), COUNT(DISTINCT "fanId"),
           COALESCE(SUM("netCents"),0) FROM tx WHERE NOT reddit
  `
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(30)} ${String(r.txs).padStart(6)} payments  ` +
        `${String(r.fans).padStart(5)} fans  ${money(Number(r.cents)).padStart(12)}`,
    )
  }

  const byKind = await prisma.$queryRaw<Array<{ kind: string; cents: bigint; txs: bigint }>>`
    SELECT COALESCE(t.kind,'other') AS kind, COALESCE(SUM(t."netCents"),0) AS cents, COUNT(*) AS txs
    FROM "OfTransaction" t
    WHERE t.ts >= ${range.start} AND t.ts < ${range.end}
      AND EXISTS (SELECT 1 FROM "OfFanClaim" fc JOIN "OfCampaign" c ON c.id = fc."campaignId"
                  WHERE fc."ofUserId"=t."ofUserId" AND fc."fanId"=t."fanId" AND c."trackedInCrm")
    GROUP BY 1 ORDER BY 2 DESC
  `
  console.log('\n  what the Reddit money is:')
  for (const k of byKind) {
    console.log(
      `    ${k.kind.padEnd(16)} ${money(Number(k.cents)).padStart(11)}  ${k.txs} payments`,
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
