import { prisma } from '@/lib/prisma'
import type { Ctx } from '@/lib/session'
import { todaysPlan } from './posting'

/** Poster home: what can be posted now, and what went wrong in the last day. */
export async function posterDashboard(ctx: Ctx, dayStart: Date, dayEnd: Date) {
  const [plan, removals, counter] = await Promise.all([
    todaysPlan(ctx, ctx.user.id, dayStart, dayEnd),
    prisma.post.findMany({
      where: {
        posterId: ctx.user.id,
        status: 'REMOVED',
        removedAt: { gte: new Date(Date.now() - 86_400_000) },
      },
      orderBy: { removedAt: 'desc' },
      take: 15,
      select: {
        id: true,
        title: true,
        removedAt: true,
        removalReason: true,
        postedAt: true,
        latestUpvotes: true,
        subreddit: { select: { name: true, tier: true } },
        redditAccount: { select: { id: true, username: true } },
      },
    }),
    prisma.post.count({
      where: { posterId: ctx.user.id, postedAt: { gte: dayStart, lt: dayEnd } },
    }),
  ])

  const ready = plan.filter((a) => a.eligible.length > 0)
  const cooling = plan
    .flatMap((a) =>
      a.blocked
        .filter((b) => b.reason === 'COOLDOWN' && b.nextEligibleAt)
        .map((b) => ({
          account: a.username,
          accountId: a.id,
          subreddit: b.subredditName,
          at: b.nextEligibleAt!,
        })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 12)

  return { plan, ready, cooling, removals, postsToday: counter }
}

/** Manager home: what needs a decision today. */
export async function managerDashboard(dayStart: Date, dayEnd: Date) {
  const now = new Date()
  const [needsAttribution, removals24h, suspensions24h, scraperFailures, silentLinks, goalMisses] =
    await Promise.all([
      prisma.post.count({ where: { attributionStatus: 'NEEDS_REVIEW' } }),
      prisma.post.count({
        where: { status: 'REMOVED', removedAt: { gte: new Date(now.getTime() - 86_400_000) } },
      }),
      prisma.redditAccount.count({
        where: { suspendedAt: { gte: new Date(now.getTime() - 86_400_000) } },
      }),
      prisma.scraperJob.count({
        where: {
          status: { in: ['FAILED', 'DEAD_LETTER'] },
          startedAt: { gte: new Date(now.getTime() - 86_400_000) },
        },
      }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n
        FROM "TrackedLink" t
        JOIN "RedditAccount" a ON a.id = t."redditAccountId"
        WHERE t.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1 FROM "Post" p
            WHERE p."redditAccountId" = a.id AND p.status = 'LIVE'
              AND p."postedAt" >= ${new Date(now.getTime() - 48 * 3_600_000)}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "FunnelEvent" f
            WHERE f."trackedLinkId" = t.id AND f.type = 'LANDED'
              AND f.ts >= ${new Date(now.getTime() - 48 * 3_600_000)}
          )
      `,
      prisma.$queryRaw<
        Array<{ id: string; name: string; role: string; goal: number; done: bigint }>
      >`
        SELECT u.id, u.name, u.role::text AS role,
               CASE WHEN u.role = 'FARMER' THEN u."dailyAccountGoal" ELSE u."dailyPostGoal" END AS goal,
               CASE WHEN u.role = 'FARMER'
                 THEN (SELECT COUNT(*) FROM "AccountCreationAttempt" a
                       WHERE a."farmerId" = u.id AND a.outcome = 'SUCCESS'
                         AND a."createdAt" >= ${dayStart} AND a."createdAt" < ${dayEnd})
                 ELSE (SELECT COUNT(*) FROM "Post" p
                       WHERE p."posterId" = u.id AND p."postedAt" >= ${dayStart} AND p."postedAt" < ${dayEnd})
               END AS done
        FROM "User" u
        WHERE u.status = 'ACTIVE' AND u.role IN ('POSTER','FARMER')
        ORDER BY u.name
      `,
    ])

  const misses = goalMisses
    .map((g) => ({ ...g, done: Number(g.done) }))
    .filter((g) => g.goal > 0 && g.done < g.goal)

  return {
    needsAttribution,
    removals24h,
    suspensions24h,
    scraperFailures,
    silentLinks: Number(silentLinks[0]?.n ?? 0),
    goalMisses: misses,
    zeroOutput: misses.filter((g) => g.done === 0),
  }
}
