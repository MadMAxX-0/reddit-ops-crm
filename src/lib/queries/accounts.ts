import { prisma } from '@/lib/prisma'
import type { Prisma, AccountStatus } from '@/generated/prisma/client'
import type { Ctx } from '@/lib/session'
import type { AccountRowDTO } from '@/lib/display/account'

export type { AccountRowDTO }

export interface AccountQuery {
  status: string[]
  health: string | undefined // 'high' | 'mid' | 'low'
  karma: string | undefined // 'k0' | 'k100' | 'k1k' | 'k10k'
  verified: string | undefined // 'yes' | 'no'
  assigned: string | undefined // 'assigned' | 'unassigned'
  creatorIds: string[]
  posterIds: string[]
  farmerIds: string[]
  q: string
  page: number
  pageSize: number
  sort: string
  dir: 'asc' | 'desc'
}

const HEALTH_BANDS: Record<string, { gte?: number; lt?: number }> = {
  high: { gte: 70 },
  mid: { gte: 40, lt: 70 },
  low: { lt: 40 },
}

const KARMA_BANDS: Record<string, { gte: number; lt?: number }> = {
  k0: { gte: 0, lt: 100 },
  k100: { gte: 100, lt: 1000 },
  k1k: { gte: 1000, lt: 10_000 },
  k10k: { gte: 10_000 },
}

const SORTABLE = new Set([
  'username',
  'healthScore',
  'karmaPost',
  'karmaComment',
  'redditCreatedAt',
  'lastCheckedAt',
  'status',
  'createdAt',
])

/**
 * Role scoping is applied in the WHERE clause, not in the UI, so a poster
 * cannot widen their view by editing the query string.
 */
export function accountScopeWhere(ctx: Ctx): Prisma.RedditAccountWhereInput {
  if (ctx.isManager) return {}
  if (ctx.user.role === 'POSTER') return { assignedPosterId: ctx.user.id }
  return { createdById: ctx.user.id }
}

export function buildAccountWhere(ctx: Ctx, q: AccountQuery): Prisma.RedditAccountWhereInput {
  const and: Prisma.RedditAccountWhereInput[] = [accountScopeWhere(ctx)]

  if (q.status.length) and.push({ status: { in: q.status as AccountStatus[] } })
  if (q.health && HEALTH_BANDS[q.health]) and.push({ healthScore: HEALTH_BANDS[q.health] })
  if (q.karma && KARMA_BANDS[q.karma]) and.push({ karmaPost: KARMA_BANDS[q.karma] })
  if (q.verified === 'yes') and.push({ NOT: { verifiedSubreddits: { isEmpty: true } } })
  if (q.verified === 'no') and.push({ verifiedSubreddits: { isEmpty: true } })
  if (q.assigned === 'assigned') and.push({ assignedPosterId: { not: null } })
  if (q.assigned === 'unassigned') and.push({ assignedPosterId: null })
  if (q.creatorIds.length) and.push({ assignedCreatorId: { in: q.creatorIds } })
  if (q.posterIds.length) and.push({ assignedPosterId: { in: q.posterIds } })
  if (q.farmerIds.length) and.push({ createdById: { in: q.farmerIds } })
  if (q.q) {
    and.push({
      OR: [
        { username: { contains: q.q, mode: 'insensitive' } },
        { emailAddress: { contains: q.q, mode: 'insensitive' } },
        { notes: { contains: q.q, mode: 'insensitive' } },
      ],
    })
  }
  return { AND: and }
}

export async function listAccounts(ctx: Ctx, q: AccountQuery) {
  const where = buildAccountWhere(ctx, q)
  const orderBy: Prisma.RedditAccountOrderByWithRelationInput = SORTABLE.has(q.sort)
    ? { [q.sort]: q.dir }
    : { healthScore: 'desc' }

  const [total, rows] = await Promise.all([
    prisma.redditAccount.count({ where }),
    prisma.redditAccount.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        username: true,
        status: true,
        healthScore: true,
        redditCreatedAt: true,
        karmaPost: true,
        karmaComment: true,
        verifiedSubreddits: true,
        lastCheckedAt: true,
        shadowbanned: true,
        suspendedAt: true,
        pollTier: true,
        suspectedMissedPosts: true,
        assignedCreator: { select: { stageName: true } },
        assignedPoster: { select: { name: true } },
        createdBy: { select: { name: true } },
        proxy: { select: { label: true } },
      },
    }),
  ])

  // 30-day post counts only for the page in view — aggregating all 2.5k accounts
  // to render 50 of them is the classic way these screens get slow.
  const ids = rows.map((r) => r.id)
  const since = new Date(Date.now() - 30 * 86_400_000)
  const grouped = ids.length
    ? await prisma.post.groupBy({
        by: ['redditAccountId', 'status'],
        where: { redditAccountId: { in: ids }, postedAt: { gte: since } },
        _count: { _all: true },
      })
    : []

  // Lifetime as well as the window. Nearly every post this operation has on
  // record predates its 30-day window — the farming accounts earned their karma
  // months ago — so a "Posts 30d" column alone reads zero across the board and
  // looks like nothing was ever scraped.
  const lifetime = ids.length
    ? await prisma.post.groupBy({
        by: ['redditAccountId'],
        where: { redditAccountId: { in: ids } },
        _count: { _all: true },
      })
    : []
  const lifetimeById = new Map(lifetime.map((g) => [g.redditAccountId, g._count._all]))

  const counts = new Map<string, { total: number; removed: number }>()
  for (const g of grouped) {
    const c = counts.get(g.redditAccountId) ?? { total: 0, removed: 0 }
    c.total += g._count._all
    if (g.status === 'REMOVED') c.removed += g._count._all
    counts.set(g.redditAccountId, c)
  }

  const now = Date.now()
  const data: AccountRowDTO[] = rows.map((r) => {
    const c = counts.get(r.id) ?? { total: 0, removed: 0 }
    return {
      id: r.id,
      username: r.username,
      status: r.status,
      healthScore: r.healthScore,
      ageDays: r.redditCreatedAt ? Math.floor((now - r.redditCreatedAt.getTime()) / 86_400_000) : 0,
      karmaPost: r.karmaPost,
      karmaComment: r.karmaComment,
      verifiedCount: r.verifiedSubreddits.length,
      verifiedSubreddits: r.verifiedSubreddits,
      creatorName: r.assignedCreator?.stageName ?? null,
      posterName: r.assignedPoster?.name ?? null,
      createdByName: r.createdBy?.name ?? null,
      proxyLabel: r.proxy?.label ?? null,
      lastCheckedAt: r.lastCheckedAt,
      shadowbanned: r.shadowbanned,
      suspendedAt: r.suspendedAt,
      pollTier: r.pollTier,
      suspectedMissedPosts: r.suspectedMissedPosts,
      posts30d: c.total,
      postsTotal: lifetimeById.get(r.id) ?? 0,
      removed30d: c.removed,
      removalRate: c.total ? c.removed / c.total : null,
    }
  })

  return { data, total, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) }
}
