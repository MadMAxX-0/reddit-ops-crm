import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ResolvedRange } from '@/lib/time'
import { redditSubsSeries, tracedRedditSeries, type FanFilter } from './traced-revenue'
import { clickDayBounds } from './clicks'

/**
 * Reddit's clicks and subscribers, taken from the OnlyFans tracking links.
 *
 * Both are exact: the difference between two readings of a link's lifetime
 * counters. Revenue is NOT computed here — it is traced fan by fan in
 * `traced-revenue.ts`, because a share of a total is a guess and this product
 * should not print guesses beside measurements.
 *
 * Deltas need two readings, so a window only reports what the readings cover.
 * `basis` says which: 'window' once a reading exists at or before the start,
 * 'partial' when the series begins inside the window, 'none' when there is
 * nothing to diff.
 */

export type LinkBasis = 'window' | 'partial' | 'none'

export interface RedditLinkTotals {
  clicks: number
  subs: number
  /** every source, for the share and for context */
  allClicks: number
  allSubs: number
  redditShare: number | null
  basis: LinkBasis
  /** oldest reading available — how far back the record actually goes */
  since: Date | null
  linkCount: number
  redditLinkCount: number
  /** Reddit links whose fan list is not fully walked — gaps in Reddit's own figure */
  redditLinksShort: number
  /** running click total across the counted links, always available */
  lifetimeClicks: number
}

interface DeltaRow {
  campaign_id: string
  of_user_id: string
  is_reddit: boolean
  reddit_account_id: string | null
  clicks: number
  subs: number
  first_ts: Date
  last_ts: Date
}

/**
 * Per-link movement inside a window: the last reading in the window minus the
 * last reading at or before it, falling back to the first reading in the window
 * when the series does not reach that far back.
 */
async function linkDeltas(start: Date, end: Date): Promise<DeltaRow[]> {
  return prisma.$queryRaw<DeltaRow[]>(Prisma.sql`
    WITH base AS (
      SELECT DISTINCT ON (s."campaignId") s."campaignId", s.clicks, s.subs, s.ts
      FROM "OfCampaignSnapshot" s
      WHERE s.ts <= ${start}
      ORDER BY s."campaignId", s.ts DESC
    ),
    inside AS (
      SELECT s."campaignId", MIN(s.ts) AS first_ts, MAX(s.ts) AS last_ts
      FROM "OfCampaignSnapshot" s
      WHERE s.ts > ${start} AND s.ts <= ${end}
      GROUP BY s."campaignId"
    ),
    endpoints AS (
      SELECT i."campaignId", i.first_ts, i.last_ts,
             (SELECT sf.clicks FROM "OfCampaignSnapshot" sf
               WHERE sf."campaignId" = i."campaignId" AND sf.ts = i.first_ts LIMIT 1) AS first_clicks,
             (SELECT sf.subs FROM "OfCampaignSnapshot" sf
               WHERE sf."campaignId" = i."campaignId" AND sf.ts = i.first_ts LIMIT 1) AS first_subs,
             (SELECT sl.clicks FROM "OfCampaignSnapshot" sl
               WHERE sl."campaignId" = i."campaignId" AND sl.ts = i.last_ts LIMIT 1) AS last_clicks,
             (SELECT sl.subs FROM "OfCampaignSnapshot" sl
               WHERE sl."campaignId" = i."campaignId" AND sl.ts = i.last_ts LIMIT 1) AS last_subs
      FROM inside i
    )
    SELECT c.id AS campaign_id,
           c."ofUserId" AS of_user_id,
           c."trackedInCrm" AS is_reddit,
           c."redditAccountId" AS reddit_account_id,
           GREATEST(e.last_clicks - COALESCE(b.clicks, e.first_clicks), 0)::int AS clicks,
           GREATEST(e.last_subs   - COALESCE(b.subs,   e.first_subs),   0)::int AS subs,
           COALESCE(b.ts, e.first_ts) AS first_ts,
           e.last_ts
    FROM endpoints e
    JOIN "OfCampaign" c ON c.id = e."campaignId"
    LEFT JOIN base b ON b."campaignId" = e."campaignId"
  `)
}

export async function redditLinkTotals(start: Date, end: Date): Promise<RedditLinkTotals> {
  const [deltas, counts, history] = await Promise.all([
    linkDeltas(start, end),
    prisma.$queryRaw<
      Array<{ all: bigint; reddit: bigint; short: bigint; lifetime_clicks: bigint }>
    >(Prisma.sql`
      SELECT COUNT(*) AS all,
             COUNT(*) FILTER (WHERE "trackedInCrm") AS reddit,
             COALESCE(SUM(clicks) FILTER (WHERE "trackedInCrm"), 0) AS lifetime_clicks,
             COUNT(*) FILTER (
               WHERE "trackedInCrm"
                 AND subs > 0 AND "claimersCached" < subs * 0.9
             ) AS short
      FROM "OfCampaign" WHERE NOT "isDeleted"
    `),
    prisma.ofCampaignSnapshot.aggregate({ _min: { ts: true } }),
  ])

  let clicks = 0
  let subs = 0
  let allClicks = 0
  let allSubs = 0
  for (const d of deltas) {
    allClicks += d.clicks
    allSubs += d.subs
    if (d.is_reddit) {
      clicks += d.clicks
      subs += d.subs
    }
  }

  const firstReading = history._min.ts ?? null
  const reachesBack = firstReading != null && firstReading <= start

  return {
    clicks,
    subs,
    allClicks,
    allSubs,
    redditShare: allSubs ? subs / allSubs : null,
    basis: deltas.length === 0 ? 'none' : reachesBack ? 'window' : 'partial',
    since: firstReading,
    linkCount: Number(counts[0]?.all ?? 0),
    redditLinkCount: Number(counts[0]?.reddit ?? 0),
    redditLinksShort: Number(counts[0]?.short ?? 0),
    lifetimeClicks: Number(counts[0]?.lifetime_clicks ?? 0),
  }
}

/** Current window and the one before it, for the dashboard's deltas. */
export async function redditLinkComparison(range: ResolvedRange) {
  const [current, prior] = await Promise.all([
    redditLinkTotals(range.start, range.end),
    redditLinkTotals(range.prevStart, range.prevEnd),
  ])
  return { current, prior }
}

export interface RedditDayPoint {
  day: string
  clicks: number
  subs: number
  revenueCents: number
}

/**
 * Reddit per day, for the dashboard chart.
 *
 * Every line here reads the same source as the tile above it, which was not
 * true before: the tiles moved to bouncy and to traced payments while this
 * function was left diffing OnlyFans' lifetime counters. Those snapshots only
 * begin on 2026-08-21, and a delta needs two of them, so the clicks line was
 * zero on every single day of any window and the chart drew nothing at all.
 *
 * clicks  — bouncy, which logs each hit against its own date and so answers for
 *           a window that closed before the CRM ever read it
 * subs    — the arrivals themselves, counted from the fans
 * revenue — payments traced to those fans
 */
export async function redditDailySeries(
  start: Date,
  end: Date,
  fans: FanFilter = 'all',
  ofUserIds?: string[],
): Promise<RedditDayPoint[]> {
  const { first, last } = clickDayBounds(start, end)
  const scope = ofUserIds?.length ? Prisma.sql`AND c."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  const [clicks, subs, revenue] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; clicks: bigint }>>(Prisma.sql`
      SELECT d.day, COALESCE(SUM(d.views), 0) AS clicks
      FROM "BouncyClickDay" d
      JOIN "BouncyLink" b ON b.id = d."bouncyId"
      JOIN "OfCampaign" c ON c.id = b."campaignId" AND c."trackedInCrm"
      WHERE d.day >= ${first}::date AND d.day <= ${last}::date ${scope}
      GROUP BY 1 ORDER BY 1
    `),
    redditSubsSeries(start, end, ofUserIds),
    tracedRedditSeries(start, end, fans, ofUserIds),
  ])

  const points = new Map<string, RedditDayPoint>()
  const at = (day: string) => {
    const p = points.get(day) ?? { day, clicks: 0, subs: 0, revenueCents: 0 }
    points.set(day, p)
    return p
  }

  for (const r of revenue) at(r.day).revenueCents += r.cents
  for (const r of subs) at(r.day).subs += r.n
  for (const r of clicks) at(r.day.toISOString().slice(0, 10)).clicks += Number(r.clicks)

  return [...points.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export interface LinkAttribution {
  campaignId: string
  redditAccountId: string | null
  /** null when the counters have not been read across the whole window */
  clicks: number | null
  subs: number | null
  /** the link's running total, which is always available */
  lifetimeClicks: number
}

/**
 * Clicks and subs per link, so an account that owns a link can be credited with
 * what it brought. An account with no link of its own gets nothing here — not
 * zero, *nothing* — because its traffic sits inside a shared Reddit link and
 * cannot be separated out.
 */
export async function linkAttribution(start: Date, end: Date): Promise<LinkAttribution[]> {
  const [deltas, history, campaigns] = await Promise.all([
    linkDeltas(start, end),
    prisma.ofCampaignSnapshot.aggregate({ _min: { ts: true } }),
    prisma.ofCampaign.findMany({
      where: { isDeleted: false },
      select: { id: true, trackedInCrm: true, redditAccountId: true, clicks: true },
    }),
  ])

  const covered = (history._min.ts ?? null) != null && history._min.ts! <= start
  const deltaById = new Map(deltas.map((d) => [d.campaign_id, d]))

  return campaigns
    .filter((c) => c.trackedInCrm)
    .map((c) => {
      const d = deltaById.get(c.id)
      // a nought that only means "not read yet" is reported as nothing at all
      const clicks = d?.clicks ?? 0
      const subs = d?.subs ?? 0
      return {
        campaignId: c.id,
        redditAccountId: c.redditAccountId,
        clicks: covered || clicks > 0 ? clicks : null,
        subs: covered || subs > 0 ? subs : null,
        lifetimeClicks: c.clicks,
      }
    })
}
