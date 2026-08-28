import { Prisma, type ScraperJobType } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { JOB_DEFAULTS } from '@/lib/jobs/config'

export interface JobHealthRow {
  type: ScraperJobType
  label: string
  description: string
  enabled: boolean
  paused: boolean
  intervalSec: number
  rateLimitPerMin: number
  maxAttempts: number
  hotIntervalSec: number
  warmIntervalSec: number
  coldIntervalSec: number
  dormantIntervalSec: number
  lastRunAt: Date | null
  lastFinishedAt: Date | null
  lastStatus: string | null
  lastDurationMs: number | null
  lastItems: number
  lastErrors: number
  lastError: string | null
  runs24h: number
  failures24h: number
  itemsProcessed24h: number
}

export async function jobHealth(): Promise<JobHealthRow[]> {
  const [configs, latest, agg] = await Promise.all([
    prisma.scraperConfig.findMany(),
    prisma.$queryRaw<
      Array<{
        type: ScraperJobType
        startedAt: Date
        finishedAt: Date | null
        status: string
        itemsProcessed: number
        errorsCount: number
        lastError: string | null
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (type)
        type, "startedAt", "finishedAt", status::text, "itemsProcessed", "errorsCount", "lastError"
      FROM "ScraperJob"
      ORDER BY type, "startedAt" DESC
    `),
    prisma.scraperJob.groupBy({
      by: ['type', 'status'],
      where: { startedAt: { gte: new Date(Date.now() - 86_400_000) } },
      _count: { _all: true },
      _sum: { itemsProcessed: true },
    }),
  ])

  const configByType = new Map(configs.map((c) => [c.type, c]))
  const latestByType = new Map(latest.map((l) => [l.type, l]))

  return (Object.keys(JOB_DEFAULTS) as ScraperJobType[]).map((type) => {
    const d = JOB_DEFAULTS[type]
    const c = configByType.get(type)
    const l = latestByType.get(type)
    const rows = agg.filter((a) => a.type === type)

    return {
      type,
      label: d.label,
      description: d.description,
      enabled: c?.enabled ?? true,
      paused: c?.paused ?? false,
      intervalSec: c?.intervalSec ?? d.intervalSec,
      rateLimitPerMin: c?.rateLimitPerMin ?? d.rateLimitPerMin,
      maxAttempts: c?.maxAttempts ?? d.maxAttempts,
      hotIntervalSec: c?.hotIntervalSec ?? 600,
      warmIntervalSec: c?.warmIntervalSec ?? 3600,
      coldIntervalSec: c?.coldIntervalSec ?? 21_600,
      dormantIntervalSec: c?.dormantIntervalSec ?? 86_400,
      lastRunAt: l?.startedAt ?? null,
      lastFinishedAt: l?.finishedAt ?? null,
      lastStatus: l?.status ?? null,
      lastDurationMs: l?.finishedAt ? l.finishedAt.getTime() - l.startedAt.getTime() : null,
      lastItems: l?.itemsProcessed ?? 0,
      lastErrors: l?.errorsCount ?? 0,
      lastError: l?.lastError ?? null,
      runs24h: rows.reduce((s, r) => s + r._count._all, 0),
      failures24h: rows
        .filter((r) => r.status === 'FAILED' || r.status === 'DEAD_LETTER')
        .reduce((s, r) => s + r._count._all, 0),
      itemsProcessed24h: rows.reduce((s, r) => s + (r._sum.itemsProcessed ?? 0), 0),
    }
  })
}

/** Hourly buckets over 48h — intermittent breakage only shows up on a timeline. */
export async function failureTimeline(hours = 48) {
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; type: string; failures: bigint; runs: bigint }>
  >(
    Prisma.sql`
      SELECT date_trunc('hour', "startedAt") AS bucket,
             type::text AS type,
             COUNT(*) FILTER (WHERE status IN ('FAILED','DEAD_LETTER')) AS failures,
             COUNT(*) AS runs
      FROM "ScraperJob"
      WHERE "startedAt" >= ${new Date(Date.now() - hours * 3_600_000)}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `,
  )
  return rows.map((r) => ({
    bucket: r.bucket,
    type: r.type,
    failures: Number(r.failures),
    runs: Number(r.runs),
  }))
}

/**
 * Discovery is only as good as its lag. If the median gap between postedAt and
 * firstSeenAt drifts up, posts removed inside that gap are invisible and the
 * removal rate silently understates itself — so it is monitored, not assumed.
 */
export async function discoveryHealth() {
  const [lag, tiers, missed, orphans, dueNow] = await Promise.all([
    prisma.$queryRaw<
      Array<{ median_min: number | null; p90_min: number | null; n: bigint }>
    >(Prisma.sql`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("firstSeenAt" - "postedAt")) / 60) AS median_min,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("firstSeenAt" - "postedAt")) / 60) AS p90_min,
        COUNT(*) AS n
      FROM "Post"
      WHERE "postedAt" >= ${new Date(Date.now() - 7 * 86_400_000)}
    `),
    prisma.redditAccount.groupBy({
      by: ['pollTier'],
      where: { status: { notIn: ['SUSPENDED', 'RETIRED'] } },
      _count: { _all: true },
    }),
    prisma.redditAccount.aggregate({ _sum: { suspectedMissedPosts: true } }),
    prisma.post.count({ where: { attributionStatus: 'NEEDS_REVIEW' } }),
    prisma.redditAccount.count({
      where: {
        status: { notIn: ['SUSPENDED', 'RETIRED'] },
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
      },
    }),
  ])

  return {
    medianLagMin: lag[0]?.median_min == null ? null : Number(lag[0].median_min),
    p90LagMin: lag[0]?.p90_min == null ? null : Number(lag[0].p90_min),
    postsSampled: Number(lag[0]?.n ?? 0),
    tiers: Object.fromEntries(tiers.map((t) => [t.pollTier, t._count._all])) as Record<
      string,
      number
    >,
    suspectedMissedPosts: missed._sum.suspectedMissedPosts ?? 0,
    needsAttribution: orphans,
    accountsDueNow: dueNow,
  }
}

export async function recentRuns(limit = 60) {
  return prisma.scraperJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      itemsProcessed: true,
      errorsCount: true,
      lastError: true,
      target: true,
    },
  })
}
