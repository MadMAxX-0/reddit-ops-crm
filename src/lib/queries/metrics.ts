import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { autoGranularity, type ResolvedRange } from '@/lib/time'
import { conversionsByPostCte } from './attribution-sql'

/**
 * The one place period metrics are computed. Overview, Dashboard, My
 * Performance, the Employee Ranking and the AI report context all read from
 * here, so a rate can only be defined once and cannot drift between screens.
 */

export interface MetricFilters {
  creatorIds?: string[]
  posterIds?: string[]
  subredditIds?: string[]
  accountIds?: string[]
}

function postWhere(f: MetricFilters, start: Date, end: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`p."postedAt" >= ${start} AND p."postedAt" < ${end}`]
  if (f.creatorIds?.length) parts.push(Prisma.sql`p."creatorId" = ANY(${f.creatorIds})`)
  if (f.posterIds?.length) parts.push(Prisma.sql`p."posterId" = ANY(${f.posterIds})`)
  if (f.subredditIds?.length) parts.push(Prisma.sql`p."subredditId" = ANY(${f.subredditIds})`)
  if (f.accountIds?.length) parts.push(Prisma.sql`p."redditAccountId" = ANY(${f.accountIds})`)
  return Prisma.join(parts, ' AND ')
}

export interface PeriodTotals {
  posts: number
  removed: number
  removalRate: number | null
  upvotes: number
  medianUpvotes: number | null
  landings: number
  uniqueLandings: number
  botLandings: number
  unattributedLandings: number
  outbound: number
  funnelPass: number | null
  conversions: number
  newSubs: number
  convRate: number | null
  revenueCents: number
  revenuePerPostCents: number | null
  revenuePerLandingCents: number | null
  ctrProxy: number | null
  accountsUsed: number
  accountsBurned: number
  accountBurnRate: number | null
  medianDiscoveryLagMin: number | null
}

export async function periodTotals(
  filters: MetricFilters,
  start: Date,
  end: Date,
  attributionWindowH = 72,
): Promise<PeriodTotals> {
  const where = postWhere(filters, start, end)
  const scoped = !!(
    filters.creatorIds?.length ||
    filters.posterIds?.length ||
    filters.subredditIds?.length ||
    filters.accountIds?.length
  )

  const [postAgg, funnelAgg, convAgg, unattributed, burn] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        posts: bigint
        removed: bigint
        upvotes: bigint
        median_upvotes: number | null
        accounts_used: bigint
        median_lag: number | null
      }>
    >(Prisma.sql`
      SELECT COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE p.status = 'REMOVED') AS removed,
             COALESCE(SUM(p."latestUpvotes"), 0) AS upvotes,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY p."latestUpvotes") AS median_upvotes,
             COUNT(DISTINCT p."redditAccountId") AS accounts_used,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (p."firstSeenAt" - p."postedAt")) / 60
             ) AS median_lag
      FROM "Post" p
      WHERE ${where}
    `),
    prisma.$queryRaw<
      Array<{ landings: bigint; unique_landings: bigint; bots: bigint; outbound: bigint }>
    >(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE f.type = 'LANDED'   AND NOT f."isBot") AS landings,
             COUNT(DISTINCT f."sessionHash") FILTER (WHERE f.type = 'LANDED' AND NOT f."isBot") AS unique_landings,
             COUNT(*) FILTER (WHERE f.type = 'LANDED'   AND f."isBot")     AS bots,
             COUNT(*) FILTER (WHERE f.type = 'OUTBOUND' AND NOT f."isBot") AS outbound
      FROM "FunnelEvent" f
      JOIN "Post" p ON p.id = f."attributedPostId"
      WHERE f.ts >= ${start} AND f.ts < ${end}
        AND ${where}
    `),
    prisma.$queryRaw<
      Array<{ conversions: bigint; new_subs: bigint; revenue_cents: bigint }>
    >(Prisma.sql`
      WITH c AS (
        SELECT po.id AS post_id, cv.type::text AS type, cv."amountCents" AS amount
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
      )
      SELECT COUNT(*) AS conversions,
             COUNT(*) FILTER (WHERE c.type IN ('FREE_SUB','TRIAL','PAID_SUB')) AS new_subs,
             COALESCE(SUM(c.amount), 0) AS revenue_cents
      FROM c
      JOIN "Post" p ON p.id = c.post_id
      WHERE ${where}
    `),
    scoped
      ? Promise.resolve([{ n: BigInt(0) }])
      : prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS n FROM "FunnelEvent"
          WHERE type = 'LANDED' AND NOT "isBot" AND "attributedPostId" IS NULL
            AND ts >= ${start} AND ts < ${end}
        `),
    prisma.$queryRaw<Array<{ burned: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT p."redditAccountId") AS burned
      FROM "Post" p
      JOIN "RedditAccount" a ON a.id = p."redditAccountId"
      WHERE ${where} AND a."suspendedAt" IS NOT NULL AND a."suspendedAt" >= ${start}
    `),
  ])

  const posts = Number(postAgg[0]?.posts ?? 0)
  const removed = Number(postAgg[0]?.removed ?? 0)
  const upvotes = Number(postAgg[0]?.upvotes ?? 0)
  const landings = Number(funnelAgg[0]?.landings ?? 0)
  const outbound = Number(funnelAgg[0]?.outbound ?? 0)
  const conversions = Number(convAgg[0]?.conversions ?? 0)
  const revenueCents = Number(convAgg[0]?.revenue_cents ?? 0)
  const accountsUsed = Number(postAgg[0]?.accounts_used ?? 0)
  const accountsBurned = Number(burn[0]?.burned ?? 0)

  return {
    posts,
    removed,
    removalRate: posts ? removed / posts : null,
    upvotes,
    medianUpvotes:
      postAgg[0]?.median_upvotes == null ? null : Math.round(Number(postAgg[0].median_upvotes)),
    landings,
    uniqueLandings: Number(funnelAgg[0]?.unique_landings ?? 0),
    botLandings: Number(funnelAgg[0]?.bots ?? 0),
    unattributedLandings: Number(unattributed[0]?.n ?? 0),
    outbound,
    funnelPass: landings ? outbound / landings : null,
    conversions,
    newSubs: Number(convAgg[0]?.new_subs ?? 0),
    convRate: landings ? conversions / landings : null,
    revenueCents,
    revenuePerPostCents: posts ? Math.round(revenueCents / posts) : null,
    revenuePerLandingCents: landings ? Math.round(revenueCents / landings) : null,
    // Labelled a proxy everywhere it is shown: we cannot see impressions, so
    // upvotes stand in for reach and the ratio is directional, not literal.
    ctrProxy: upvotes ? landings / upvotes : null,
    accountsUsed,
    accountsBurned,
    accountBurnRate: accountsUsed ? accountsBurned / accountsUsed : null,
    medianDiscoveryLagMin:
      postAgg[0]?.median_lag == null ? null : Math.round(Number(postAgg[0].median_lag)),
  }
}

/** Totals for the window plus the immediately preceding one, for deltas. */
export async function periodWithComparison(
  filters: MetricFilters,
  range: ResolvedRange,
  attributionWindowH = 72,
) {
  const [current, prior] = await Promise.all([
    periodTotals(filters, range.start, range.end, attributionWindowH),
    periodTotals(filters, range.prevStart, range.prevEnd, attributionWindowH),
  ])
  return { current, prior }
}

export interface SeriesPoint {
  bucket: Date
  posts: number
  removed: number
  landings: number
  revenueCents: number
}

export async function timeSeries(
  filters: MetricFilters,
  range: ResolvedRange,
  boundaryTz: string,
  attributionWindowH = 72,
): Promise<{ points: SeriesPoint[]; granularity: 'hour' | 'day' | 'week' }> {
  const granularity = autoGranularity(range)
  const where = postWhere(filters, range.start, range.end)
  // Bucket in the workspace day-boundary timezone, so a "day" on the chart is
  // the same day the goals and the ranking count. The zone is interpolated into
  // SQL, so it is validated against the IANA shape rather than trusted.
  const tz = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(boundaryTz) ? boundaryTz : 'UTC'
  const startIso = range.start.toISOString().replace('Z', '')
  const endIso = range.end.toISOString().replace('Z', '')
  const trunc = (col: string) =>
    Prisma.raw(`date_trunc('${granularity}', (${col} AT TIME ZONE 'UTC' AT TIME ZONE '${tz}'))`)

  // A bucket with no post is a day nobody posted, which is a zero on the chart —
  // not a day that does not exist. Grouping alone dropped those days entirely,
  // so a week with four posting days drew a four-point line whose x-axis skipped
  // the gaps, and the prior-period line (aligned by position) compared day 3 of
  // this week against whichever day happened to be third last week. The spine
  // gives every bucket in the range a row before anything is joined onto it.
  const spine = Prisma.sql`
    SELECT generate_series(
      ${trunc(`'${startIso}'::timestamp`)},
      ${trunc(`('${endIso}'::timestamp - interval '1 microsecond')`)},
      ${Prisma.raw(`'1 ${granularity}'::interval`)}
    ) AS bucket
  `

  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; posts: bigint; removed: bigint; landings: bigint; revenue_cents: bigint }>
  >(Prisma.sql`
    WITH p AS (
      SELECT ${trunc('p."postedAt"')} AS bucket,
             COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE p.status = 'REMOVED') AS removed
      FROM "Post" p
      WHERE ${where}
      GROUP BY 1
    ),
    l AS (
      SELECT ${trunc('f.ts')} AS bucket,
             COUNT(*) AS landings
      FROM "FunnelEvent" f
      JOIN "Post" p ON p.id = f."attributedPostId"
      WHERE f.type = 'LANDED' AND NOT f."isBot"
        AND f.ts >= ${range.start} AND f.ts < ${range.end}
        AND ${where}
      GROUP BY 1
    ),
    c AS (
      SELECT ${trunc('cv."occurredAt"')} AS bucket,
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
      JOIN "Post" p ON p.id = fe."attributedPostId"
      WHERE cv."occurredAt" >= ${range.start} AND cv."occurredAt" < ${range.end}
        AND cv."trackedLinkId" IS NOT NULL
        AND ${where}
      GROUP BY 1
    ),
    s AS (${spine})
    SELECT s.bucket AS bucket,
           COALESCE(p.posts, 0) AS posts,
           COALESCE(p.removed, 0) AS removed,
           COALESCE(l.landings, 0) AS landings,
           COALESCE(c.revenue_cents, 0) AS revenue_cents
    FROM s
    LEFT JOIN p ON p.bucket = s.bucket
    LEFT JOIN l ON l.bucket = s.bucket
    LEFT JOIN c ON c.bucket = s.bucket
    ORDER BY 1 ASC
  `)

  return {
    granularity,
    points: rows.map((r) => ({
      bucket: r.bucket,
      posts: Number(r.posts),
      removed: Number(r.removed),
      landings: Number(r.landings),
      revenueCents: Number(r.revenue_cents),
    })),
  }
}

export interface BreakdownRow {
  id: string
  name: string
  meta: string | null
  posts: number
  removed: number
  removalRate: number | null
  medianUpvotes: number | null
  landings: number
  conversions: number
  revenueCents: number
  revenuePerPostCents: number | null
}

/** Shared shape for the Top subreddits / Top creators / per-VA tables. */
export async function breakdown(
  dimension: 'subreddit' | 'creator' | 'poster',
  filters: MetricFilters,
  range: ResolvedRange,
  attributionWindowH = 72,
  limit = 12,
): Promise<BreakdownRow[]> {
  const where = postWhere(filters, range.start, range.end)
  const col =
    dimension === 'subreddit' ? 'subredditId' : dimension === 'creator' ? 'creatorId' : 'posterId'
  const groupCol = Prisma.raw(`p."${col}"`)

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      posts: bigint
      removed: bigint
      median_upvotes: number | null
      landings: bigint
      conversions: bigint
      revenue_cents: bigint
    }>
  >(Prisma.sql`
    WITH p AS (
      SELECT ${groupCol} AS id,
             COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE p.status = 'REMOVED') AS removed,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY p."latestUpvotes") AS median_upvotes
      FROM "Post" p
      WHERE ${where} AND ${groupCol} IS NOT NULL
      GROUP BY 1
    ),
    l AS (
      SELECT ${groupCol} AS id, COUNT(*) AS landings
      FROM "FunnelEvent" f
      JOIN "Post" p ON p.id = f."attributedPostId"
      WHERE f.type = 'LANDED' AND NOT f."isBot"
        AND f.ts >= ${range.start} AND f.ts < ${range.end}
        AND ${where} AND ${groupCol} IS NOT NULL
      GROUP BY 1
    ),
    c AS (
      ${conversionsByPostCte(range.start, range.end, attributionWindowH, col as never)}
    )
    SELECT p.id,
           p.posts, p.removed, p.median_upvotes,
           COALESCE(l.landings, 0) AS landings,
           COALESCE(c.conversions, 0) AS conversions,
           COALESCE(c.revenue_cents, 0) AS revenue_cents
    FROM p
    LEFT JOIN l ON l.id = p.id
    LEFT JOIN c ON c.group_id = p.id
    ORDER BY revenue_cents DESC, p.posts DESC
    LIMIT ${limit}
  `)

  const ids = rows.map((r) => r.id)
  const labels = new Map<string, { name: string; meta: string | null }>()
  if (ids.length) {
    if (dimension === 'subreddit') {
      const subs = await prisma.subreddit.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, tier: true, status: true },
      })
      for (const s of subs)
        labels.set(s.id, {
          name: `r/${s.name}`,
          meta: `${s.tier} · ${s.status.toLowerCase().replace(/_/g, ' ')}`,
        })
    } else if (dimension === 'creator') {
      const cs = await prisma.creator.findMany({
        where: { id: { in: ids } },
        select: { id: true, stageName: true, niche: true },
      })
      for (const c of cs) labels.set(c.id, { name: c.stageName, meta: c.niche })
    } else {
      const us = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, role: true },
      })
      for (const u of us) labels.set(u.id, { name: u.name, meta: u.role.toLowerCase() })
    }
  }

  return rows.map((r) => {
    const posts = Number(r.posts)
    const removed = Number(r.removed)
    const revenueCents = Number(r.revenue_cents)
    return {
      id: r.id,
      name: labels.get(r.id)?.name ?? r.id,
      meta: labels.get(r.id)?.meta ?? null,
      posts,
      removed,
      removalRate: posts ? removed / posts : null,
      medianUpvotes: r.median_upvotes == null ? null : Math.round(Number(r.median_upvotes)),
      landings: Number(r.landings),
      conversions: Number(r.conversions),
      revenueCents,
      revenuePerPostCents: posts ? Math.round(revenueCents / posts) : null,
    }
  })
}

export async function recentPosts(filters: MetricFilters, range: ResolvedRange, limit = 25) {
  return prisma.post.findMany({
    where: {
      postedAt: { gte: range.start, lt: range.end },
      ...(filters.creatorIds?.length ? { creatorId: { in: filters.creatorIds } } : {}),
      ...(filters.posterIds?.length ? { posterId: { in: filters.posterIds } } : {}),
      ...(filters.subredditIds?.length ? { subredditId: { in: filters.subredditIds } } : {}),
    },
    orderBy: { postedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      postedAt: true,
      firstSeenAt: true,
      status: true,
      latestUpvotes: true,
      url: true,
      attributionStatus: true,
      subreddit: { select: { name: true, tier: true } },
      redditAccount: { select: { id: true, username: true } },
      creator: { select: { stageName: true } },
      poster: { select: { name: true } },
      _count: { select: { funnelEvents: true } },
    },
  })
}
