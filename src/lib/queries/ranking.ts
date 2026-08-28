import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { dayBounds, dayDateColumn, type DayKey } from '@/lib/time'

/**
 * The Employee Ranking — one dense row per VA for one workspace-day.
 *
 * Posters and farmers are judged on different work, so each column carries the
 * measure that is meaningful for that role rather than forcing both into one
 * definition and quietly making half the table meaningless. The shape of every
 * cell is identical: a primary value with a muted qualifier underneath.
 *
 * Everything here is derived for the requested day in the workspace
 * day-boundary timezone. Nothing is a stored counter.
 */

export interface RankingRow {
  userId: string
  name: string
  role: 'POSTER' | 'FARMER'
  timezone: string

  // accounts made (farmers)
  accountsMade: number
  failedCreate: number
  failedVerify: number
  failedCaptcha: number
  attempts: number

  // daily goal
  goal: number
  goalCurrent: number
  overdue: number
  overdueLabel: string

  // content
  content: number
  contentSub: string

  // orders: completed / assigned
  ordersCompleted: number
  ordersAssigned: number
  ordersSub: string

  // quality
  survival7d: number | null
  survivalEligible: number
  successRate: number | null
  successSub: string

  verifiedCount: number
  verifiedTotal: number
  missingDetails: number
  missingSub: string

  netCostCents: number
  refundedCents: number
  /** posters only: distinct hours in which they posted */
  activeHours: number | null

  firstActivity: Date | null
  lastActivity: Date | null
}

export type RankingMetric =
  'goal' | 'accountsMade' | 'content' | 'survival7d' | 'successRate' | 'netCost'

export async function employeeRanking(
  key: DayKey,
  boundaryTz: string,
  opts: { metric?: RankingMetric; userIds?: string[] } = {},
): Promise<RankingRow[]> {
  const { start, end } = dayBounds(key, boundaryTz)
  const batchDate = dayDateColumn(key)
  const now = new Date()

  const users = await prisma.user.findMany({
    where: {
      role: { in: ['POSTER', 'FARMER'] },
      status: 'ACTIVE',
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      role: true,
      timezone: true,
      dailyAccountGoal: true,
      dailyPostGoal: true,
      hourlyCostCents: true,
    },
  })
  if (!users.length) return []
  const ids = users.map((u) => u.id)

  const [
    attempts,
    posts,
    posterActivity,
    sessions,
    survival,
    custody,
    farmerAccounts,
    posterAccounts,
    windows,
  ] = await Promise.all([
    prisma.accountCreationAttempt.groupBy({
      by: ['farmerId', 'outcome'],
      where: { farmerId: { in: ids }, batchDate },
      _count: { _all: true },
      _sum: { costCents: true, refundedCents: true },
    }),
    prisma.post.groupBy({
      by: ['posterId', 'status'],
      where: { posterId: { in: ids }, postedAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    // distinct accounts a poster actually used today, and the distinct hours
    // they posted in — the second is a far better proxy for time worked than
    // first-to-last, which spans the whole day because posting follows the
    // audience rather than the VA's shift
    prisma.$queryRaw<
      Array<{ user_id: string; accounts_used: bigint; active_hours: bigint }>
    >(Prisma.sql`
        SELECT "posterId" AS user_id,
               COUNT(DISTINCT "redditAccountId") AS accounts_used,
               COUNT(DISTINCT date_trunc('hour', "postedAt")) AS active_hours
        FROM "Post"
        WHERE "posterId" = ANY(${ids}) AND "postedAt" >= ${start} AND "postedAt" < ${end}
        GROUP BY 1
      `),
    prisma.farmingSession.groupBy({
      by: ['farmerId'],
      where: { farmerId: { in: ids }, startedAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { durationMin: true, commentsMade: true },
    }),
    // 7-day survival across everything they have ever touched, not just today —
    // one day is far too small a sample to grade quality on.
    //
    // A farmer is judged on the accounts they CREATED; a poster on the
    // accounts they POST FROM. Same question ("does this person burn
    // inventory?"), different set, because they control different halves of it.
    prisma.$queryRaw<Array<{ user_id: string; eligible: bigint; alive: bigint }>>(Prisma.sql`
        SELECT user_id, COUNT(*) AS eligible,
               COUNT(*) FILTER (
                 WHERE "suspendedAt" IS NULL
                    OR "suspendedAt" > "redditCreatedAt" + interval '7 days'
               ) AS alive
        FROM (
          SELECT "createdById" AS user_id, "suspendedAt", "redditCreatedAt"
          FROM "RedditAccount"
          WHERE "createdById" = ANY(${ids})
            AND "redditCreatedAt" <= ${new Date(now.getTime() - 7 * 86_400_000)}
        ) x
        GROUP BY 1
      `),
    // Posters get a different question. An account is only handed to a poster
    // once it is warmed, so by then it has already survived its first week and
    // "7d survival" would read 100% for everyone. What a poster actually
    // controls is whether inventory dies UNDER THEIR CUSTODY, so that is what
    // is measured: accounts they have held for 7+ days that are still alive.
    prisma.$queryRaw<Array<{ user_id: string; eligible: bigint; alive: bigint }>>(Prisma.sql`
        SELECT asg."posterId" AS user_id,
               COUNT(DISTINCT asg."redditAccountId") AS eligible,
               COUNT(DISTINCT asg."redditAccountId") FILTER (WHERE a."suspendedAt" IS NULL) AS alive
        FROM "AccountAssignment" asg
        JOIN "RedditAccount" a ON a.id = asg."redditAccountId"
        WHERE asg."posterId" = ANY(${ids})
          AND asg."startedAt" <= ${new Date(now.getTime() - 7 * 86_400_000)}
        GROUP BY 1
      `),
    // farmer inventory: still warming past the point it should be ready
    prisma.$queryRaw<
      Array<{
        user_id: string
        warming: bigint
        overdue: bigint
        verified: bigint
        total: bigint
        missing: bigint
      }>
    >(Prisma.sql`
        SELECT "createdById" AS user_id,
               COUNT(*) FILTER (WHERE status = 'WARMING') AS warming,
               COUNT(*) FILTER (
                 WHERE status = 'WARMING' AND "redditCreatedAt" < ${new Date(now.getTime() - 21 * 86_400_000)}
               ) AS overdue,
               COUNT(*) FILTER (WHERE "emailVerified" AND "phoneVerified") AS verified,
               COUNT(*) AS total,
               COUNT(*) FILTER (
                 WHERE "emailProvider" IS NULL OR "proxyId" IS NULL OR NOT "phoneVerified"
               ) AS missing
        FROM "RedditAccount"
        WHERE "createdById" = ANY(${ids})
        GROUP BY 1
      `),
    // poster inventory: assigned accounts, and how many are sitting idle
    prisma.$queryRaw<
      Array<{ user_id: string; assigned: bigint; idle: bigint; verified: bigint; no_link: bigint }>
    >(Prisma.sql`
        SELECT a."assignedPosterId" AS user_id,
               COUNT(*) AS assigned,
               COUNT(*) FILTER (
                 WHERE a."lastPostAt" IS NULL OR a."lastPostAt" < ${new Date(now.getTime() - 7 * 86_400_000)}
               ) AS idle,
               COUNT(*) FILTER (WHERE cardinality(a."verifiedSubreddits") > 0) AS verified,
               COUNT(*) FILTER (
                 WHERE NOT EXISTS (
                   SELECT 1 FROM "TrackedLink" t
                   WHERE t."redditAccountId" = a.id AND t.status = 'ACTIVE'
                 )
               ) AS no_link
        FROM "RedditAccount" a
        WHERE a."assignedPosterId" = ANY(${ids})
          AND a.status IN ('ACTIVE','READY')
        GROUP BY 1
      `),
    prisma.$queryRaw<
      Array<{ user_id: string; first_at: Date | null; last_at: Date | null }>
    >(Prisma.sql`
        SELECT user_id, MIN(at) AS first_at, MAX(at) AS last_at FROM (
          SELECT "farmerId" AS user_id, "createdAt" AS at
          FROM "AccountCreationAttempt"
          WHERE "farmerId" = ANY(${ids}) AND "batchDate" = ${batchDate}
          UNION ALL
          SELECT "farmerId", "startedAt"
          FROM "FarmingSession"
          WHERE "farmerId" = ANY(${ids}) AND "startedAt" >= ${start} AND "startedAt" < ${end}
          UNION ALL
          SELECT "posterId", "postedAt"
          FROM "Post"
          WHERE "posterId" = ANY(${ids}) AND "postedAt" >= ${start} AND "postedAt" < ${end}
        ) e
        WHERE user_id IS NOT NULL
        GROUP BY 1
      `),
  ])

  const idx = <T extends { user_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.user_id, r]))
  const survivalBy = idx(survival)
  const custodyBy = idx(custody)
  const activityBy = idx(posterActivity)
  const farmerBy = idx(farmerAccounts)
  const posterBy = idx(posterAccounts)
  const windowBy = idx(windows)

  const rows: RankingRow[] = users.map((u) => {
    const isFarmer = u.role === 'FARMER'
    const mine = attempts.filter((a) => a.farmerId === u.id)
    const count = (o: string) => mine.find((a) => a.outcome === o)?._count._all ?? 0
    const accountsMade = count('SUCCESS')
    const failedCreate = count('FAILED_CREATE')
    const failedVerify = count('FAILED_VERIFY')
    const failedCaptcha = count('FAILED_CAPTCHA')
    const attemptTotal = accountsMade + failedCreate + failedVerify + failedCaptcha
    const costCents = mine.reduce((s, a) => s + (a._sum.costCents ?? 0), 0)
    const refundedCents = mine.reduce((s, a) => s + (a._sum.refundedCents ?? 0), 0)

    const activity = activityBy.get(u.id)
    const myPosts = posts.filter((p) => p.posterId === u.id)
    const postCount = myPosts.reduce((s, p) => s + p._count._all, 0)
    const removedCount = myPosts.find((p) => p.status === 'REMOVED')?._count._all ?? 0

    const mySession = sessions.find((s) => s.farmerId === u.id)
    const sessionCount = mySession?._count._all ?? 0
    const sessionMinutes = mySession?._sum.durationMin ?? 0
    const sessionComments = mySession?._sum.commentsMade ?? 0

    const surv = isFarmer ? survivalBy.get(u.id) : custodyBy.get(u.id)
    const survEligible = Number(surv?.eligible ?? 0)
    const survAlive = Number(surv?.alive ?? 0)

    const farm = farmerBy.get(u.id)
    const post = posterBy.get(u.id)

    const goal = isFarmer ? u.dailyAccountGoal : u.dailyPostGoal
    const goalCurrent = isFarmer ? accountsMade : postCount

    const overdue = isFarmer ? Number(farm?.overdue ?? 0) : Number(post?.idle ?? 0)
    const overdueLabel = isFarmer ? 'stuck in warm-up' : 'accounts idle 7d+'

    const w = windowBy.get(u.id)

    return {
      userId: u.id,
      name: u.name,
      role: u.role as 'POSTER' | 'FARMER',
      timezone: u.timezone,

      accountsMade,
      failedCreate,
      failedVerify,
      failedCaptcha,
      attempts: attemptTotal,

      goal,
      goalCurrent,
      overdue,
      overdueLabel,

      content: isFarmer ? sessionCount : postCount,
      contentSub: isFarmer
        ? `${sessionMinutes}m · ${sessionComments} comments`
        : `${removedCount} removed`,

      // Farmers: accounts brought to posting-ready out of everything they made.
      // Posters: how much of the assigned inventory they actually used today —
      // "posts / accounts assigned" would just restate the goal column.
      ordersCompleted: isFarmer
        ? Number(farm?.total ?? 0) - Number(farm?.warming ?? 0)
        : Number(activity?.accounts_used ?? 0),
      ordersAssigned: isFarmer ? Number(farm?.total ?? 0) : Number(post?.assigned ?? 0),
      ordersSub: isFarmer
        ? `${Number(farm?.warming ?? 0)} still warming`
        : `accounts used of assigned`,

      survival7d: survEligible ? survAlive / survEligible : null,
      survivalEligible: survEligible,

      successRate: isFarmer
        ? attemptTotal
          ? accountsMade / attemptTotal
          : null
        : postCount
          ? (postCount - removedCount) / postCount
          : null,
      successSub: isFarmer
        ? attemptTotal
          ? `${accountsMade}/${attemptTotal} attempts`
          : 'no attempts'
        : postCount
          ? `${postCount - removedCount}/${postCount} survived`
          : 'no posts',

      verifiedCount: isFarmer ? Number(farm?.verified ?? 0) : Number(post?.verified ?? 0),
      verifiedTotal: isFarmer ? Number(farm?.total ?? 0) : Number(post?.assigned ?? 0),
      missingDetails: isFarmer ? Number(farm?.missing ?? 0) : Number(post?.no_link ?? 0),
      missingSub: isFarmer ? 'no proxy, provider or phone' : 'accounts with no live deep link',

      netCostCents: isFarmer
        ? costCents - refundedCents
        : // a poster's cost is their time, and time is counted as the distinct
          // hours they actually posted in, not first-to-last
          u.hourlyCostCents * Number(activity?.active_hours ?? 0),
      refundedCents,
      activeHours: isFarmer ? null : Number(activity?.active_hours ?? 0),

      firstActivity: w?.first_at ?? null,
      lastActivity: w?.last_at ?? null,
    }
  })

  return sortRanking(rows, opts.metric ?? 'goal')
}

export function sortRanking(rows: RankingRow[], metric: RankingMetric): RankingRow[] {
  const value = (r: RankingRow): number => {
    switch (metric) {
      case 'accountsMade':
        return r.accountsMade
      case 'content':
        return r.content
      case 'survival7d':
        return r.survival7d ?? -1
      case 'successRate':
        return r.successRate ?? -1
      case 'netCost':
        // cheapest first is the useful order for a cost column
        return -r.netCostCents
      case 'goal':
      default:
        return r.goal ? r.goalCurrent / r.goal : -1
    }
  }
  return [...rows].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name))
}

export const RANKING_METRICS: { value: RankingMetric; label: string }[] = [
  { value: 'goal', label: 'Goal attainment' },
  { value: 'accountsMade', label: 'Accounts made' },
  { value: 'content', label: 'Content' },
  { value: 'survival7d', label: '7d survival' },
  { value: 'successRate', label: 'Success rate' },
  { value: 'netCost', label: 'Net cost' },
]
