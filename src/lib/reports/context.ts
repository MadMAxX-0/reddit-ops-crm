import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { breakdown, periodTotals, timeSeries, type MetricFilters } from '@/lib/queries/metrics'
import { employeeRanking } from '@/lib/queries/ranking'
import { listSubreddits } from '@/lib/queries/subreddits'
import { dayBounds, dayKeysInRange, type DayKey } from '@/lib/time'

/**
 * Reports are generated from pre-aggregated results, never raw rows.
 *
 * Two reasons, and the second is the important one:
 *   1. Token cost stays flat regardless of how much data the period contains.
 *   2. The model can only cite numbers that are actually in this object, so it
 *      cannot invent a figure it never saw. Everything the report claims is
 *      traceable to a key in here, and the whole object is stored alongside the
 *      report so any number can be walked back to its source.
 */

export type ReportScope = 'GLOBAL' | 'CREATOR' | 'VA' | 'SUBREDDIT'

export interface Period {
  start: Date
  end: Date
  label: string
  days: number
}

export interface Anomaly {
  metric: string
  value: number
  baselineMean: number
  baselineSd: number
  z: number
  direction: 'above' | 'below'
  note: string
}

export interface ReportContext {
  meta: {
    workspace: string
    dayBoundaryTimezone: string
    scope: ReportScope
    scopeId: string | null
    scopeName: string | null
    period: { start: string; end: string; label: string; days: number }
    priorPeriod: { start: string; end: string }
    generatedAt: string
    currency: 'USD'
    /** every *Cents field is an integer number of cents */
    moneyUnit: 'cents'
  }
  totals: Record<string, number | null>
  prior: Record<string, number | null>
  change: Record<string, number | null>
  dailySeries: Array<{
    day: DayKey
    posts: number
    removed: number
    landings: number
    revenueCents: number
  }>
  subreddits: Array<Record<string, number | string | null>>
  creators: Array<Record<string, number | string | null>>
  vas: Array<Record<string, number | string | null>>
  bestAndWorst: {
    bestSubredditByRevenuePerPost: string | null
    worstSubredditByRemovalRate: string | null
    bestCreatorByRevenue: string | null
    bestVaByGoalAttainment: string | null
    worstVaByGoalAttainment: string | null
  }
  anomalies: Anomaly[]
  dataQuality: {
    postsNeedingAttribution: number
    suspectedMissedPosts: number
    medianDiscoveryLagMin: number | null
    unattributedLandings: number
    inferredAttributionShare: number | null
    scraperFailures24h: number
    accountsWithLivePostsNoLandings: number
    /** so the model can say "too small to be meaningful" instead of quoting noise */
    smallSampleThresholdPosts: number
    smallSampleSubredditCount: number
    smallSampleSubreddits: string[]
  }
}

const round = (n: number | null | undefined, dp = 4): number | null =>
  n == null || !Number.isFinite(n) ? null : Number(n.toFixed(dp))

function changeMap(
  current: Record<string, number | null>,
  prior: Record<string, number | null>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const key of Object.keys(current)) {
    const c = current[key]
    const p = prior[key]
    if (c == null || p == null || p === 0) {
      out[key] = null
      continue
    }
    out[key] = round((c - p) / p)
  }
  return out
}

/**
 * z-score of the period's daily averages against a trailing 30-day baseline
 * that EXCLUDES the period itself — otherwise the period drags the baseline
 * toward itself and nothing ever looks anomalous.
 */
async function detectAnomalies(
  filters: MetricFilters,
  period: Period,
  boundaryTz: string,
): Promise<Anomaly[]> {
  const baselineEnd = period.start
  const baselineStart = new Date(baselineEnd.getTime() - 30 * 86_400_000)
  const tz = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(boundaryTz) ? boundaryTz : 'UTC'

  const where: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (filters.creatorIds?.length) where.push(Prisma.sql`p."creatorId" = ANY(${filters.creatorIds})`)
  if (filters.posterIds?.length) where.push(Prisma.sql`p."posterId" = ANY(${filters.posterIds})`)
  if (filters.subredditIds?.length)
    where.push(Prisma.sql`p."subredditId" = ANY(${filters.subredditIds})`)
  const scope = Prisma.join(where, ' AND ')

  const rows = await prisma.$queryRaw<
    Array<{ day: Date; posts: bigint; removed: bigint; upvotes: bigint }>
  >(Prisma.sql`
    SELECT date_trunc('day', (p."postedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${Prisma.raw(`'${tz}'`)})) AS day,
           COUNT(*) AS posts,
           COUNT(*) FILTER (WHERE p.status = 'REMOVED') AS removed,
           COALESCE(SUM(p."latestUpvotes"), 0) AS upvotes
    FROM "Post" p
    WHERE p."postedAt" >= ${baselineStart} AND p."postedAt" < ${baselineEnd} AND ${scope}
    GROUP BY 1
  `)

  const periodTotalsRow = await periodTotals(filters, period.start, period.end)

  const series = {
    postsPerDay: rows.map((r) => Number(r.posts)),
    removalRate: rows
      .filter((r) => Number(r.posts) > 0)
      .map((r) => Number(r.removed) / Number(r.posts)),
    upvotesPerPost: rows
      .filter((r) => Number(r.posts) > 0)
      .map((r) => Number(r.upvotes) / Number(r.posts)),
  }

  const checks: Array<{ metric: string; value: number | null; sample: number[]; note: string }> = [
    {
      metric: 'posts_per_day',
      value: period.days ? periodTotalsRow.posts / period.days : null,
      sample: series.postsPerDay,
      note: 'Daily post volume against the trailing 30 days before this period.',
    },
    {
      metric: 'removal_rate',
      value: periodTotalsRow.removalRate,
      sample: series.removalRate,
      note: 'Share of posts removed by moderators.',
    },
    {
      metric: 'upvotes_per_post',
      value: periodTotalsRow.posts ? periodTotalsRow.upvotes / periodTotalsRow.posts : null,
      sample: series.upvotesPerPost,
      note: 'Mean upvotes per post — a reach proxy, not an impression count.',
    },
  ]

  const out: Anomaly[] = []
  for (const check of checks) {
    // fewer than 10 baseline days cannot support a z-score worth quoting
    if (check.value == null || check.sample.length < 10) continue
    const mean = check.sample.reduce((s, v) => s + v, 0) / check.sample.length
    const variance =
      check.sample.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, check.sample.length - 1)
    const sd = Math.sqrt(variance)
    if (sd === 0) continue
    const z = (check.value - mean) / sd
    if (Math.abs(z) < 2) continue
    out.push({
      metric: check.metric,
      value: round(check.value)!,
      baselineMean: round(mean)!,
      baselineSd: round(sd)!,
      z: round(z, 2)!,
      direction: z > 0 ? 'above' : 'below',
      note: check.note,
    })
  }
  return out
}

export async function buildReportContext(
  scope: ReportScope,
  scopeId: string | null,
  period: Period,
): Promise<ReportContext> {
  const workspace = await prisma.workspace.findFirst()
  const boundaryTz = workspace?.dayBoundaryTimezone ?? 'UTC'
  const attributionWindowH = workspace?.attributionWindowH ?? 72

  const filters: MetricFilters = {
    creatorIds: scope === 'CREATOR' && scopeId ? [scopeId] : [],
    posterIds: scope === 'VA' && scopeId ? [scopeId] : [],
    subredditIds: scope === 'SUBREDDIT' && scopeId ? [scopeId] : [],
  }

  const priorStart = new Date(
    period.start.getTime() - (period.end.getTime() - period.start.getTime()),
  )
  const range = {
    start: period.start,
    end: period.end,
    prevStart: priorStart,
    prevEnd: period.start,
    preset: 'custom' as const,
    label: period.label,
  }

  const [totals, prior, subs, creators, ranking, subredditRows, anomalies, quality] =
    await Promise.all([
      periodTotals(filters, period.start, period.end, attributionWindowH),
      periodTotals(filters, priorStart, period.start, attributionWindowH),
      breakdown('subreddit', filters, range, attributionWindowH, 15),
      breakdown('creator', filters, range, attributionWindowH, 15),
      employeeRanking(
        dayKeysInRange({ start: period.start, end: period.end }, boundaryTz).at(-1)!,
        boundaryTz,
      ),
      listSubreddits(range, attributionWindowH),
      detectAnomalies(filters, period, boundaryTz),
      dataQuality(period),
    ])

  const seriesData = await timeSeries(filters, range, boundaryTz, attributionWindowH)

  const scopeName = await resolveScopeName(scope, scopeId)
  const smallSampleThreshold = Math.max(5, Math.round(period.days * 1.5))
  const smallSample = subredditRows
    .filter((s) => s.posts > 0 && s.posts < smallSampleThreshold)
    .map((s) => s.name)

  const totalsFlat: Record<string, number | null> = {
    posts: totals.posts,
    removed: totals.removed,
    removalRate: round(totals.removalRate),
    upvotes: totals.upvotes,
    medianUpvotes: totals.medianUpvotes,
    landings: totals.landings,
    uniqueLandings: totals.uniqueLandings,
    botLandings: totals.botLandings,
    outbound: totals.outbound,
    funnelPassRate: round(totals.funnelPass),
    conversions: totals.conversions,
    newSubs: totals.newSubs,
    convRate: round(totals.convRate),
    revenueCents: totals.revenueCents,
    revenuePerPostCents: totals.revenuePerPostCents,
    revenuePerLandingCents: totals.revenuePerLandingCents,
    ctrProxy: round(totals.ctrProxy),
    accountsUsed: totals.accountsUsed,
    accountsBurned: totals.accountsBurned,
    accountBurnRate: round(totals.accountBurnRate),
    medianDiscoveryLagMin: totals.medianDiscoveryLagMin,
  }
  const priorFlat: Record<string, number | null> = {
    posts: prior.posts,
    removed: prior.removed,
    removalRate: round(prior.removalRate),
    upvotes: prior.upvotes,
    landings: prior.landings,
    outbound: prior.outbound,
    funnelPassRate: round(prior.funnelPass),
    conversions: prior.conversions,
    newSubs: prior.newSubs,
    convRate: round(prior.convRate),
    revenueCents: prior.revenueCents,
    revenuePerPostCents: prior.revenuePerPostCents,
    ctrProxy: round(prior.ctrProxy),
  }

  const rankedVas = ranking.filter((r) => r.goal > 0)
  const byAttainment = [...rankedVas].sort(
    (a, b) => b.goalCurrent / b.goal - a.goalCurrent / a.goal,
  )

  return {
    meta: {
      workspace: workspace?.name ?? 'Workspace',
      dayBoundaryTimezone: boundaryTz,
      scope,
      scopeId,
      scopeName,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
        days: period.days,
      },
      priorPeriod: { start: priorStart.toISOString(), end: period.start.toISOString() },
      generatedAt: new Date().toISOString(),
      currency: 'USD',
      moneyUnit: 'cents',
    },
    totals: totalsFlat,
    prior: priorFlat,
    change: changeMap(totalsFlat, priorFlat),
    dailySeries: seriesData.points.map((p) => ({
      day: p.bucket.toISOString().slice(0, 10),
      posts: p.posts,
      removed: p.removed,
      landings: p.landings,
      revenueCents: p.revenueCents,
    })),
    subreddits: subs.map((s) => ({
      name: s.name,
      tier: s.meta?.split(' ')[0] ?? null,
      posts: s.posts,
      removed: s.removed,
      removalRate: round(s.removalRate),
      medianUpvotes: s.medianUpvotes,
      landings: s.landings,
      conversions: s.conversions,
      revenueCents: s.revenueCents,
      revenuePerPostCents: s.revenuePerPostCents,
    })),
    creators: creators.map((c) => ({
      name: c.name,
      niche: c.meta,
      posts: c.posts,
      removalRate: round(c.removalRate),
      medianUpvotes: c.medianUpvotes,
      landings: c.landings,
      conversions: c.conversions,
      revenueCents: c.revenueCents,
      revenuePerPostCents: c.revenuePerPostCents,
    })),
    vas: ranking.map((r) => ({
      name: r.name,
      role: r.role,
      goal: r.goal,
      achieved: r.goalCurrent,
      goalAttainment: r.goal ? round(r.goalCurrent / r.goal) : null,
      accountsMade: r.role === 'FARMER' ? r.accountsMade : null,
      failedCreate: r.role === 'FARMER' ? r.failedCreate : null,
      postsToday: r.role === 'POSTER' ? r.content : null,
      successRate: round(r.successRate),
      survival7d: round(r.survival7d),
      survivalSample: r.survivalEligible,
      overdue: r.overdue,
      missingDetails: r.missingDetails,
      netCostCents: r.netCostCents,
    })),
    bestAndWorst: {
      bestSubredditByRevenuePerPost:
        [...subs]
          .filter((s) => s.posts >= 8)
          .sort((a, b) => (b.revenuePerPostCents ?? 0) - (a.revenuePerPostCents ?? 0))[0]?.name ??
        null,
      worstSubredditByRemovalRate:
        [...subs]
          .filter((s) => s.posts >= 8)
          .sort((a, b) => (b.removalRate ?? 0) - (a.removalRate ?? 0))[0]?.name ?? null,
      bestCreatorByRevenue: creators[0]?.name ?? null,
      bestVaByGoalAttainment: byAttainment[0]?.name ?? null,
      worstVaByGoalAttainment: byAttainment.at(-1)?.name ?? null,
    },
    anomalies,
    dataQuality: {
      ...quality,
      medianDiscoveryLagMin: totals.medianDiscoveryLagMin,
      unattributedLandings: totals.unattributedLandings,
      // Scale the bar with the window: on a one-day brief almost every
      // subreddit is small-sample, and listing forty names is noise. Give the
      // model the threshold and the count, plus a handful of names.
      smallSampleThresholdPosts: smallSampleThreshold,
      smallSampleSubredditCount: smallSample.length,
      smallSampleSubreddits: smallSample.slice(0, 10),
    },
  }
}

async function dataQuality(period: Period) {
  const [needsAttribution, missed, inferred, failures, silent] = await Promise.all([
    prisma.post.count({ where: { attributionStatus: 'NEEDS_REVIEW' } }),
    prisma.redditAccount.aggregate({ _sum: { suspectedMissedPosts: true } }),
    prisma.$queryRaw<Array<{ inferred: bigint; total: bigint }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE "attributionType" = 'INFERRED') AS inferred, COUNT(*) AS total
      FROM "FunnelEvent"
      WHERE type = 'LANDED' AND NOT "isBot" AND ts >= ${period.start} AND ts < ${period.end}
    `),
    prisma.scraperJob.count({
      where: {
        status: { in: ['FAILED', 'DEAD_LETTER'] },
        startedAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS n FROM "TrackedLink" t
      JOIN "RedditAccount" a ON a.id = t."redditAccountId"
      WHERE t.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM "Post" p WHERE p."redditAccountId" = a.id AND p.status = 'LIVE'
                    AND p."postedAt" >= ${new Date(Date.now() - 48 * 3_600_000)})
        AND NOT EXISTS (SELECT 1 FROM "FunnelEvent" f WHERE f."trackedLinkId" = t.id
                        AND f.type = 'LANDED' AND f.ts >= ${new Date(Date.now() - 48 * 3_600_000)})
    `),
  ])

  const total = Number(inferred[0]?.total ?? 0)
  return {
    postsNeedingAttribution: needsAttribution,
    suspectedMissedPosts: missed._sum.suspectedMissedPosts ?? 0,
    inferredAttributionShare: total ? round(Number(inferred[0].inferred) / total) : null,
    scraperFailures24h: failures,
    accountsWithLivePostsNoLandings: Number(silent[0]?.n ?? 0),
  }
}

async function resolveScopeName(scope: ReportScope, scopeId: string | null) {
  if (!scopeId) return null
  if (scope === 'CREATOR') {
    return (
      (await prisma.creator.findUnique({ where: { id: scopeId }, select: { stageName: true } }))
        ?.stageName ?? null
    )
  }
  if (scope === 'VA') {
    return (
      (await prisma.user.findUnique({ where: { id: scopeId }, select: { name: true } }))?.name ??
      null
    )
  }
  if (scope === 'SUBREDDIT') {
    const s = await prisma.subreddit.findUnique({ where: { id: scopeId }, select: { name: true } })
    return s ? `r/${s.name}` : null
  }
  return null
}

/** Named periods used by the scheduled report types. */
export function periodFor(kind: string, boundaryTz: string, anchor = new Date()): Period {
  const dayMs = 86_400_000
  const todayStart = dayBounds(
    new Date(anchor.getTime()).toISOString().slice(0, 10),
    boundaryTz,
  ).start

  switch (kind) {
    case 'daily_ops': {
      const end = todayStart
      const start = new Date(end.getTime() - dayMs)
      return { start, end, label: 'Yesterday', days: 1 }
    }
    case 'weekly_creator':
    case 'weekly_va': {
      const end = todayStart
      const start = new Date(end.getTime() - 7 * dayMs)
      return { start, end, label: 'Last 7 days', days: 7 }
    }
    case 'subreddit_intel': {
      const end = todayStart
      const start = new Date(end.getTime() - 30 * dayMs)
      return { start, end, label: 'Last 30 days', days: 30 }
    }
    default: {
      const end = todayStart
      const start = new Date(end.getTime() - 7 * dayMs)
      return { start, end, label: 'Last 7 days', days: 7 }
    }
  }
}
