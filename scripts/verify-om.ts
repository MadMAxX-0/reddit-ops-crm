/** Reconcile the CRM's per-link subscriber counts against OnlyMonster's screen. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

async function main() {
  const start = new Date('2026-07-22T00:00:00Z')
  const end = new Date('2026-08-22T00:00:00Z')
  const rows = await prisma.$queryRaw<Array<{ model: string; code: number; name: string; n: bigint }>>`
    WITH arrivals AS (
      SELECT campaign_id, COALESCE(MIN(om_arrived), MIN(other_arrived)) AS arrived, fan_id
      FROM (
        SELECT c.id AS campaign_id, om."fanId" AS fan_id, om."subscribedAt" AS om_arrived, NULL::timestamp AS other_arrived
        FROM "OmLinkFan" om JOIN "OfCampaign" c ON c."ofCampaignId" = om."linkId" WHERE c."trackedInCrm"
        UNION ALL
        SELECT c.id, fc."fanId", NULL::timestamp, COALESCE(fc."subscribedAt", f."subscribedAt")
        FROM "OfFanClaim" fc JOIN "OfCampaign" c ON c.id = fc."campaignId"
        LEFT JOIN "OfFan" f ON f."ofUserId" = fc."ofUserId" AND f."fanId" = fc."fanId"
        WHERE c."trackedInCrm"
      ) s GROUP BY 1, 3
    )
    SELECT c."ofUsername" AS model, c."campaignCode" AS code, c.name,
           COUNT(DISTINCT a.fan_id) AS n
    FROM arrivals a JOIN "OfCampaign" c ON c.id = a.campaign_id
    WHERE a.arrived >= ${start} AND a.arrived < ${end}
    GROUP BY 1,2,3 HAVING COUNT(DISTINCT a.fan_id) > 0
    ORDER BY 4 DESC
  `
  console.log('subs by link, 22 Jul – 21 Aug')
  for (const r of rows) {
    console.log(`  ${(r.model ?? '').padEnd(15)} c${String(r.code).padEnd(4)} ${r.name.slice(0, 30).padEnd(32)} ${r.n}`)
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
