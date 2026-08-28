import { Prisma } from '@/generated/prisma/client'

/**
 * Conversions carry a tracked link, not a post. Walking from a conversion back
 * to the post that earned it means picking the ONE outbound click that
 * plausibly caused it: the most recent one on that link at or before the
 * conversion, inside the attribution window.
 *
 * The naive version of this — joining Conversion to FunnelEvent on
 * trackedLinkId alone — multiplies every conversion by the number of outbound
 * clicks that link ever had. It reads as spectacular conversion rates and
 * revenue that does not reconcile with the ledger, which is exactly the kind of
 * number that gets believed before it gets checked. Hence LATERAL … LIMIT 1.
 */
export function conversionsByPostCte(
  start: Date,
  end: Date,
  attributionWindowH: number,
  groupBy: 'subredditId' | 'creatorId' | 'posterId' | 'id',
) {
  const col = Prisma.raw(`po."${groupBy}"`)
  return Prisma.sql`
    SELECT ${col} AS group_id,
           COUNT(*) AS conversions,
           COALESCE(SUM(cv."amountCents"), 0) AS revenue_cents
    FROM "Conversion" cv
    JOIN LATERAL (
      SELECT fe."attributedPostId"
      FROM "FunnelEvent" fe
      WHERE fe."trackedLinkId" = cv."trackedLinkId"
        AND fe.type = 'OUTBOUND'
        AND fe."attributedPostId" IS NOT NULL
        AND fe.ts <= cv."occurredAt"
        AND fe.ts >= cv."occurredAt" - ${`${attributionWindowH} hours`}::interval
      ORDER BY fe.ts DESC
      LIMIT 1
    ) fe ON TRUE
    JOIN "Post" po ON po.id = fe."attributedPostId"
    WHERE cv."occurredAt" >= ${start} AND cv."occurredAt" < ${end}
      AND cv."trackedLinkId" IS NOT NULL
    GROUP BY 1
  `
}
