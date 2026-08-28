import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Clicks for a period, from bouncy.ai.
 *
 * The only genuinely per-period click data in this product. OnlyFans and
 * OnlyMonster both expose a lifetime counter per link, so a window from them is
 * the difference between two readings and cannot describe a period that began
 * before the readings did. Bouncy sits in front of the OnlyFans link and logs
 * each hit with its date, so a window that has already passed still answers.
 *
 * It counts a step earlier in the funnel than OnlyFans does: a hit on the bio
 * link, not an arrival at OnlyFans. For u/SillySinx over the same month that is
 * 3,230 against 2,269 — the gap is people who clicked and never landed. Both
 * are real; they are not the same measurement, and the CRM labels this one
 * "clicks" because it is what the Reddit post actually earned.
 */

/**
 * The calendar days a window touches.
 *
 * bouncy files a click under a day, not an instant, so a window has to be
 * turned into a range of days before it can be matched. The upper bound is
 * INCLUSIVE of the last day the window overlaps: `end` is the first moment
 * after the window, so `end::date` is today for every window that runs up to
 * now — and comparing `day < end::date` therefore threw away today's clicks on
 * every screen. A 24-hour window read 150 when bouncy showed 194.
 *
 * The dates are derived here rather than cast in SQL so the answer cannot
 * depend on the database session's timezone.
 */
export function clickDayBounds(start: Date, end: Date) {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return { first: day(start), last: day(new Date(end.getTime() - 1)) }
}

export interface ClickTotals {
  clicks: number
  /** the portion whose referrer was a Reddit site or app */
  fromReddit: number
  /** tracked links that have a bouncy link at all — the coverage behind the figure */
  linksCovered: number
  linksTotal: number
}

export async function clickTotals(
  start: Date,
  end: Date,
  ofUserIds?: string[],
): Promise<ClickTotals> {
  const { first, last } = clickDayBounds(start, end)
  // scoped on the campaign, because a bouncy link points at exactly one
  // OnlyFans account and that is what "this model's clicks" means
  const scope = ofUserIds?.length ? Prisma.sql`AND c."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  const [totals, coverage] = await Promise.all([
    prisma.$queryRaw<Array<{ clicks: bigint; reddit: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(d.views), 0) AS clicks, COALESCE(SUM(d."redditViews"), 0) AS reddit
      FROM "BouncyClickDay" d
      JOIN "BouncyLink" b ON b.id = d."bouncyId"
      JOIN "OfCampaign" c ON c.id = b."campaignId" AND c."trackedInCrm"
      WHERE d.day >= ${first}::date AND d.day <= ${last}::date ${scope}
    `),
    prisma.$queryRaw<Array<{ covered: bigint; total: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT c.id) FILTER (WHERE b.id IS NOT NULL) AS covered,
             COUNT(DISTINCT c.id) AS total
      FROM "OfCampaign" c
      LEFT JOIN "BouncyLink" b ON b."campaignId" = c.id
      WHERE c."trackedInCrm" AND NOT c."isDeleted" ${scope}
    `),
  ])
  return {
    clicks: Number(totals[0]?.clicks ?? 0),
    fromReddit: Number(totals[0]?.reddit ?? 0),
    linksCovered: Number(coverage[0]?.covered ?? 0),
    linksTotal: Number(coverage[0]?.total ?? 0),
  }
}

/** Clicks per Reddit account, for the per-account table. */
export async function clicksByRedditAccount(start: Date, end: Date) {
  const { first, last } = clickDayBounds(start, end)
  const rows = await prisma.$queryRaw<
    Array<{ reddit_account_id: string; clicks: bigint }>
  >(Prisma.sql`
    SELECT c."redditAccountId" AS reddit_account_id, COALESCE(SUM(d.views), 0) AS clicks
    FROM "BouncyClickDay" d
    JOIN "BouncyLink" b ON b.id = d."bouncyId"
    JOIN "OfCampaign" c ON c.id = b."campaignId"
    WHERE d.day >= ${first}::date AND d.day <= ${last}::date
      AND c."trackedInCrm" AND c."redditAccountId" IS NOT NULL
    GROUP BY 1
  `)
  return new Map(rows.map((r) => [r.reddit_account_id, Number(r.clicks)]))
}

/** Clicks per day, for the chart. */
export async function clickSeries(start: Date, end: Date, ofUserIds?: string[]) {
  const { first, last } = clickDayBounds(start, end)
  const scope = ofUserIds?.length ? Prisma.sql`AND c."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ day: Date; clicks: bigint }>>(Prisma.sql`
    SELECT d.day, COALESCE(SUM(d.views), 0) AS clicks
    FROM "BouncyClickDay" d
    JOIN "BouncyLink" b ON b.id = d."bouncyId"
    JOIN "OfCampaign" c ON c.id = b."campaignId" AND c."trackedInCrm"
    WHERE d.day >= ${first}::date AND d.day <= ${last}::date ${scope}
    GROUP BY 1 ORDER BY 1
  `)
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), clicks: Number(r.clicks) }))
}
