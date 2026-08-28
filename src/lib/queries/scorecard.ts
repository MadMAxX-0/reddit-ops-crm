import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { dayBounds, dayKeysInRange, todayKey, type DayKey } from '@/lib/time'
import { employeeRanking, sortRanking, type RankingMetric } from './ranking'

/**
 * A VA's own scorecard. Managers can open anyone's; a VA only ever sees their
 * own. Nothing here exposes another VA's pay or personal data — rank is shown,
 * the numbers behind other people's rank are not.
 */

export interface DayPoint {
  day: DayKey
  value: number
  goal: number
  met: boolean
  /** posters only */
  removed: number
}

export async function dailyOutput(
  userId: string,
  role: 'POSTER' | 'FARMER',
  goal: number,
  boundaryTz: string,
  days = 30,
): Promise<DayPoint[]> {
  const end = dayBounds(todayKey(boundaryTz), boundaryTz).end
  const start = new Date(end.getTime() - days * 86_400_000)
  const keys = dayKeysInRange({ start, end }, boundaryTz)

  const tz = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(boundaryTz) ? boundaryTz : 'UTC'

  const rows =
    role === 'FARMER'
      ? await prisma.$queryRaw<Array<{ day: string; value: bigint; removed: bigint }>>(Prisma.sql`
          SELECT to_char("batchDate", 'YYYY-MM-DD') AS day,
                 COUNT(*) FILTER (WHERE outcome = 'SUCCESS') AS value,
                 COUNT(*) FILTER (WHERE outcome <> 'SUCCESS') AS removed
          FROM "AccountCreationAttempt"
          WHERE "farmerId" = ${userId} AND "batchDate" >= ${start}
          GROUP BY 1
        `)
      : await prisma.$queryRaw<Array<{ day: string; value: bigint; removed: bigint }>>(Prisma.sql`
          SELECT to_char(("postedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${Prisma.raw(`'${tz}'`)}), 'YYYY-MM-DD') AS day,
                 COUNT(*) AS value,
                 COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed
          FROM "Post"
          WHERE "posterId" = ${userId} AND "postedAt" >= ${start}
          GROUP BY 1
        `)

  const by = new Map(rows.map((r) => [r.day, r]))
  return keys.map((day) => {
    const r = by.get(day)
    const value = Number(r?.value ?? 0)
    return { day, value, goal, met: goal > 0 && value >= goal, removed: Number(r?.removed ?? 0) }
  })
}

/** Consecutive days hitting goal, counted back from the most recent full day. */
export function goalStreak(points: DayPoint[]): { current: number; best: number; hitRate: number } {
  let current = 0
  let best = 0
  let run = 0
  let hits = 0

  for (const p of points) {
    if (p.met) {
      run += 1
      hits += 1
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  // the current streak runs backwards from the end, skipping today if it is
  // still in progress and already met
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].met) current += 1
    else break
  }
  return { current, best, hitRate: points.length ? hits / points.length : 0 }
}

export interface QualityMetrics {
  posts: number
  medianUpvotes: number | null
  removalRate: number | null
  landings: number
  ctrProxy: number | null
  conversions: number
  convRate: number | null
  revenueCents: number
  accountsMade: number
  successRate: number | null
  survival7d: number | null
  sessions: number
  sessionMinutes: number
  karmaPerHour: number | null
  accountsToReady: number
}

export async function qualityMetrics(
  userId: string,
  role: 'POSTER' | 'FARMER',
  start: Date,
  end: Date,
  attributionWindowH = 72,
): Promise<QualityMetrics> {
  if (role === 'POSTER') {
    const [postAgg, funnel, conv] = await Promise.all([
      prisma.$queryRaw<
        Array<{ posts: bigint; removed: bigint; median: number | null; upvotes: bigint }>
      >(Prisma.sql`
        SELECT COUNT(*) AS posts,
               COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "latestUpvotes") AS median,
               COALESCE(SUM("latestUpvotes"), 0) AS upvotes
        FROM "Post"
        WHERE "posterId" = ${userId} AND "postedAt" >= ${start} AND "postedAt" < ${end}
      `),
      prisma.$queryRaw<Array<{ landings: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS landings
        FROM "FunnelEvent" f
        JOIN "Post" p ON p.id = f."attributedPostId"
        WHERE f.type = 'LANDED' AND NOT f."isBot"
          AND f.ts >= ${start} AND f.ts < ${end}
          AND p."posterId" = ${userId}
      `),
      prisma.$queryRaw<Array<{ conversions: bigint; revenue: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS conversions, COALESCE(SUM(cv."amountCents"), 0) AS revenue
        FROM "Conversion" cv
        JOIN LATERAL (
          SELECT fe."attributedPostId" FROM "FunnelEvent" fe
          WHERE fe."trackedLinkId" = cv."trackedLinkId" AND fe.type = 'OUTBOUND'
            AND fe."attributedPostId" IS NOT NULL
            AND fe.ts <= cv."occurredAt"
            AND fe.ts >= cv."occurredAt" - ${`${attributionWindowH} hours`}::interval
          ORDER BY fe.ts DESC LIMIT 1
        ) fe ON TRUE
        JOIN "Post" p ON p.id = fe."attributedPostId"
        WHERE cv."occurredAt" >= ${start} AND cv."occurredAt" < ${end}
          AND cv."trackedLinkId" IS NOT NULL AND p."posterId" = ${userId}
      `),
    ])

    const posts = Number(postAgg[0]?.posts ?? 0)
    const removed = Number(postAgg[0]?.removed ?? 0)
    const upvotes = Number(postAgg[0]?.upvotes ?? 0)
    const landings = Number(funnel[0]?.landings ?? 0)
    const conversions = Number(conv[0]?.conversions ?? 0)

    return {
      posts,
      medianUpvotes: postAgg[0]?.median == null ? null : Math.round(Number(postAgg[0].median)),
      removalRate: posts ? removed / posts : null,
      landings,
      ctrProxy: upvotes ? landings / upvotes : null,
      conversions,
      convRate: landings ? conversions / landings : null,
      revenueCents: Number(conv[0]?.revenue ?? 0),
      accountsMade: 0,
      successRate: posts ? (posts - removed) / posts : null,
      survival7d: null,
      sessions: 0,
      sessionMinutes: 0,
      karmaPerHour: null,
      accountsToReady: 0,
    }
  }

  const [attempts, sessions, survival, ready] = await Promise.all([
    prisma.accountCreationAttempt.groupBy({
      by: ['outcome'],
      where: { farmerId: userId, createdAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    prisma.farmingSession.aggregate({
      where: { farmerId: userId, startedAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { durationMin: true, karmaBefore: true, karmaAfter: true },
    }),
    prisma.$queryRaw<Array<{ eligible: bigint; alive: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS eligible,
             COUNT(*) FILTER (
               WHERE "suspendedAt" IS NULL OR "suspendedAt" > "redditCreatedAt" + interval '7 days'
             ) AS alive
      FROM "RedditAccount"
      WHERE "createdById" = ${userId}
        AND "redditCreatedAt" <= ${new Date(Date.now() - 7 * 86_400_000)}
    `),
    prisma.redditAccount.count({
      where: { createdById: userId, status: { in: ['READY', 'ACTIVE'] } },
    }),
  ])

  const made = attempts.find((a) => a.outcome === 'SUCCESS')?._count._all ?? 0
  const total = attempts.reduce((s, a) => s + a._count._all, 0)
  const minutes = sessions._sum.durationMin ?? 0
  const karmaGained = (sessions._sum.karmaAfter ?? 0) - (sessions._sum.karmaBefore ?? 0)
  const eligible = Number(survival[0]?.eligible ?? 0)

  return {
    posts: 0,
    medianUpvotes: null,
    removalRate: null,
    landings: 0,
    ctrProxy: null,
    conversions: 0,
    convRate: null,
    revenueCents: 0,
    accountsMade: made,
    successRate: total ? made / total : null,
    survival7d: eligible ? Number(survival[0].alive) / eligible : null,
    sessions: sessions._count._all,
    sessionMinutes: minutes,
    karmaPerHour: minutes ? karmaGained / (minutes / 60) : null,
    accountsToReady: ready,
  }
}

/**
 * Rank among peers on the metrics their role is judged on.
 * Returns the position only — never the other VAs' underlying numbers.
 */
export async function peerRank(
  userId: string,
  role: 'POSTER' | 'FARMER',
  key: DayKey,
  boundaryTz: string,
): Promise<
  Array<{ metric: RankingMetric; label: string; rank: number; of: number; value: number | null }>
> {
  const rows = (await employeeRanking(key, boundaryTz)).filter((r) => r.role === role)
  const metrics: Array<{
    metric: RankingMetric
    label: string
    read: (r: (typeof rows)[number]) => number | null
  }> =
    role === 'POSTER'
      ? [
          {
            metric: 'goal',
            label: 'Goal attainment',
            read: (r) => (r.goal ? r.goalCurrent / r.goal : null),
          },
          { metric: 'content', label: 'Posts today', read: (r) => r.content },
          { metric: 'successRate', label: 'Posts surviving', read: (r) => r.successRate },
          { metric: 'survival7d', label: '7d account survival', read: (r) => r.survival7d },
        ]
      : [
          {
            metric: 'goal',
            label: 'Goal attainment',
            read: (r) => (r.goal ? r.goalCurrent / r.goal : null),
          },
          { metric: 'accountsMade', label: 'Accounts made', read: (r) => r.accountsMade },
          { metric: 'successRate', label: 'Creation success', read: (r) => r.successRate },
          { metric: 'survival7d', label: '7d survival', read: (r) => r.survival7d },
        ]

  return metrics.map((m) => {
    const sorted = sortRanking(rows, m.metric)
    const idx = sorted.findIndex((r) => r.userId === userId)
    const me = rows.find((r) => r.userId === userId)
    return {
      metric: m.metric,
      label: m.label,
      rank: idx >= 0 ? idx + 1 : 0,
      of: sorted.length,
      value: me ? m.read(me) : null,
    }
  })
}
