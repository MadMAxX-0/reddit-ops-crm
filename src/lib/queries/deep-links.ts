import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { Ctx } from '@/lib/session'
import type { ResolvedRange } from '@/lib/time'

export interface DeepLinkRow {
  trackedLinkId: string
  accountId: string
  username: string
  accountStatus: string
  creatorName: string | null
  posterName: string | null
  slug: string
  funnelUrl: string
  ofTrackingLinkId: string | null
  linkStatus: string
  landings: number
  uniqueLandings: number
  botLandings: number
  outbound: number
  funnelPass: number | null
  conversions: number
  revenueCents: number
  revenuePerLandingCents: number | null
  livePosts: number
  /** live posts but no landing in 48h — the bio link is broken or the account is shadowbanned */
  silent: boolean
}

/**
 * One row per Reddit account, because the account is the unit of attribution.
 *
 * Bot landings are counted but excluded from every rate: a funnel pass rate
 * diluted by preview fetchers tells you nothing about the page.
 */
export async function listDeepLinks(
  ctx: Ctx,
  range: ResolvedRange,
  opts: {
    creatorIds: string[]
    posterIds: string[]
    q: string
    page: number
    pageSize: number
    sort: string
    dir: 'asc' | 'desc'
    onlySilent?: boolean
  },
) {
  const scopePoster = ctx.isManager ? null : ctx.user.id
  const sortable: Record<string, string> = {
    landings: 'landings',
    outbound: 'outbound',
    conversions: 'conversions',
    revenue: 'revenue_cents',
    funnelPass: 'funnel_pass',
    username: 'username',
  }
  const orderCol = sortable[opts.sort] ?? 'revenue_cents'
  const orderDir = opts.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const filters: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (scopePoster) filters.push(Prisma.sql`a."assignedPosterId" = ${scopePoster}`)
  if (opts.creatorIds.length)
    filters.push(Prisma.sql`a."assignedCreatorId" = ANY(${opts.creatorIds})`)
  if (opts.posterIds.length) filters.push(Prisma.sql`a."assignedPosterId" = ANY(${opts.posterIds})`)
  if (opts.q) filters.push(Prisma.sql`a.username ILIKE ${'%' + opts.q + '%'}`)
  const where = Prisma.join(filters, ' AND ')

  const rows = await prisma.$queryRaw<
    Array<{
      tracked_link_id: string
      account_id: string
      username: string
      account_status: string
      creator_name: string | null
      poster_name: string | null
      slug: string
      funnel_url: string
      of_tracking_link_id: string | null
      link_status: string
      landings: bigint
      unique_landings: bigint
      bot_landings: bigint
      outbound: bigint
      conversions: bigint
      revenue_cents: bigint
      live_posts: bigint
      last_landing_at: Date | null
      total_count: bigint
    }>
  >(Prisma.sql`
    WITH ev AS (
      SELECT f."trackedLinkId",
             COUNT(*) FILTER (WHERE f.type = 'LANDED'   AND NOT f."isBot") AS landings,
             COUNT(DISTINCT f."sessionHash") FILTER (WHERE f.type = 'LANDED' AND NOT f."isBot") AS unique_landings,
             COUNT(*) FILTER (WHERE f.type = 'LANDED'   AND f."isBot")     AS bot_landings,
             COUNT(*) FILTER (WHERE f.type = 'OUTBOUND' AND NOT f."isBot") AS outbound,
             MAX(f.ts) FILTER (WHERE f.type = 'LANDED') AS last_landing_at
      FROM "FunnelEvent" f
      WHERE f.ts >= ${range.start} AND f.ts < ${range.end}
      GROUP BY f."trackedLinkId"
    ),
    conv AS (
      SELECT c."trackedLinkId",
             COUNT(*) AS conversions,
             COALESCE(SUM(c."amountCents"), 0) AS revenue_cents
      FROM "Conversion" c
      WHERE c."occurredAt" >= ${range.start} AND c."occurredAt" < ${range.end}
        AND c."trackedLinkId" IS NOT NULL
      GROUP BY c."trackedLinkId"
    ),
    posts AS (
      -- 48h, matching the landing window below. Comparing "posted in 7 days"
      -- against "landed in 48 hours" flags every account that simply posted
      -- five days ago, and an alert that fires on healthy accounts stops being
      -- read at all.
      SELECT p."redditAccountId", COUNT(*) AS live_posts
      FROM "Post" p
      WHERE p.status = 'LIVE' AND p."postedAt" >= ${new Date(Date.now() - 48 * 3_600_000)}
      GROUP BY p."redditAccountId"
    )
    SELECT t.id                       AS tracked_link_id,
           a.id                       AS account_id,
           a.username                 AS username,
           a.status::text             AS account_status,
           cr."stageName"             AS creator_name,
           u.name                     AS poster_name,
           t.slug                     AS slug,
           t."funnelUrl"              AS funnel_url,
           t."ofTrackingLinkId"       AS of_tracking_link_id,
           t.status::text             AS link_status,
           COALESCE(ev.landings, 0)          AS landings,
           COALESCE(ev.unique_landings, 0)   AS unique_landings,
           COALESCE(ev.bot_landings, 0)      AS bot_landings,
           COALESCE(ev.outbound, 0)          AS outbound,
           COALESCE(conv.conversions, 0)     AS conversions,
           COALESCE(conv.revenue_cents, 0)   AS revenue_cents,
           COALESCE(posts.live_posts, 0)     AS live_posts,
           ev.last_landing_at                AS last_landing_at,
           COUNT(*) OVER ()                  AS total_count
    FROM "TrackedLink" t
    JOIN "RedditAccount" a ON a.id = t."redditAccountId"
    LEFT JOIN "Creator" cr ON cr.id = a."assignedCreatorId"
    LEFT JOIN "User" u     ON u.id = a."assignedPosterId"
    LEFT JOIN ev    ON ev."trackedLinkId" = t.id
    LEFT JOIN conv  ON conv."trackedLinkId" = t.id
    LEFT JOIN posts ON posts."redditAccountId" = a.id
    WHERE ${where}
      ${
        opts.onlySilent
          ? Prisma.sql`AND COALESCE(posts.live_posts,0) > 0 AND COALESCE(ev.landings,0) = 0`
          : Prisma.empty
      }
    ORDER BY ${Prisma.raw(`"${orderCol}"`)} ${orderDir} NULLS LAST, a.username ASC
    LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}
  `)

  const total = rows.length ? Number(rows[0].total_count) : 0
  const cutoff = Date.now() - 48 * 3_600_000

  const data: DeepLinkRow[] = rows.map((r) => {
    const landings = Number(r.landings)
    const outbound = Number(r.outbound)
    const revenueCents = Number(r.revenue_cents)
    return {
      trackedLinkId: r.tracked_link_id,
      accountId: r.account_id,
      username: r.username,
      accountStatus: r.account_status,
      creatorName: r.creator_name,
      posterName: r.poster_name,
      slug: r.slug,
      funnelUrl: r.funnel_url,
      ofTrackingLinkId: r.of_tracking_link_id,
      linkStatus: r.link_status,
      landings,
      uniqueLandings: Number(r.unique_landings),
      botLandings: Number(r.bot_landings),
      outbound,
      funnelPass: landings ? outbound / landings : null,
      conversions: Number(r.conversions),
      revenueCents,
      revenuePerLandingCents: landings ? Math.round(revenueCents / landings) : null,
      livePosts: Number(r.live_posts),
      // live posts in the last 48h, yet nothing landed in the last 48h
      silent:
        Number(r.live_posts) > 0 && (!r.last_landing_at || r.last_landing_at.getTime() < cutoff),
    }
  })

  return { data, total, pageCount: Math.max(1, Math.ceil(total / opts.pageSize)) }
}

/** Detail: funnel steps, timeline, geo/device, and which posts fed the landings. */
export async function deepLinkDetail(ctx: Ctx, trackedLinkId: string, range: ResolvedRange) {
  const link = await prisma.trackedLink.findFirst({
    where: {
      id: trackedLinkId,
      ...(ctx.isManager ? {} : { redditAccount: { assignedPosterId: ctx.user.id } }),
    },
    select: {
      id: true,
      slug: true,
      funnelUrl: true,
      ofTrackingLinkId: true,
      status: true,
      issuedAt: true,
      redditAccount: {
        select: {
          id: true,
          username: true,
          status: true,
          shadowbanned: true,
          assignedCreator: { select: { stageName: true, ofUsername: true } },
          assignedPoster: { select: { name: true } },
        },
      },
    },
  })
  if (!link) return null

  const [byType, byDay, byCountry, byDevice, conv, byPost] = await Promise.all([
    prisma.funnelEvent.groupBy({
      by: ['type', 'isBot'],
      where: { trackedLinkId, ts: { gte: range.start, lt: range.end } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; landings: bigint; outbound: bigint }>>(Prisma.sql`
      SELECT date_trunc('day', ts) AS day,
             COUNT(*) FILTER (WHERE type = 'LANDED'   AND NOT "isBot") AS landings,
             COUNT(*) FILTER (WHERE type = 'OUTBOUND' AND NOT "isBot") AS outbound
      FROM "FunnelEvent"
      WHERE "trackedLinkId" = ${trackedLinkId} AND ts >= ${range.start} AND ts < ${range.end}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.funnelEvent.groupBy({
      by: ['countryCode'],
      where: {
        trackedLinkId,
        type: 'LANDED',
        isBot: false,
        ts: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
      orderBy: { _count: { countryCode: 'desc' } },
      take: 8,
    }),
    prisma.funnelEvent.groupBy({
      by: ['deviceType'],
      where: {
        trackedLinkId,
        type: 'LANDED',
        isBot: false,
        ts: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
    }),
    prisma.conversion.groupBy({
      by: ['type'],
      where: { trackedLinkId, occurredAt: { gte: range.start, lt: range.end } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.$queryRaw<
      Array<{
        post_id: string
        title: string
        subreddit: string
        posted_at: Date
        upvotes: number
        landings: bigint
        inferred: bigint
      }>
    >(Prisma.sql`
      SELECT p.id AS post_id, p.title, s.name AS subreddit, p."postedAt" AS posted_at,
             p."latestUpvotes" AS upvotes,
             COUNT(*) FILTER (WHERE f.type = 'LANDED' AND NOT f."isBot") AS landings,
             COUNT(*) FILTER (WHERE f.type = 'LANDED' AND NOT f."isBot" AND f."attributionType" = 'INFERRED') AS inferred
      FROM "FunnelEvent" f
      JOIN "Post" p      ON p.id = f."attributedPostId"
      JOIN "Subreddit" s ON s.id = p."subredditId"
      WHERE f."trackedLinkId" = ${trackedLinkId} AND f.ts >= ${range.start} AND f.ts < ${range.end}
      GROUP BY 1,2,3,4,5
      ORDER BY landings DESC
      LIMIT 25
    `),
  ])

  const landings = byType.find((b) => b.type === 'LANDED' && !b.isBot)?._count._all ?? 0
  const botLandings = byType.find((b) => b.type === 'LANDED' && b.isBot)?._count._all ?? 0
  const outbound = byType.find((b) => b.type === 'OUTBOUND' && !b.isBot)?._count._all ?? 0
  const conversions = conv.reduce((s, c) => s + c._count._all, 0)
  const revenueCents = conv.reduce((s, c) => s + (c._sum.amountCents ?? 0), 0)

  return {
    link,
    steps: { landings, outbound, conversions },
    botLandings,
    revenueCents,
    conversionsByType: conv.map((c) => ({
      type: c.type,
      count: c._count._all,
      amountCents: c._sum.amountCents ?? 0,
    })),
    timeline: byDay.map((d) => ({
      day: d.day,
      landings: Number(d.landings),
      outbound: Number(d.outbound),
    })),
    geo: byCountry.map((c) => ({ code: c.countryCode ?? 'unknown', count: c._count._all })),
    devices: byDevice.map((d) => ({ device: d.deviceType ?? 'unknown', count: d._count._all })),
    posts: byPost.map((p) => ({
      postId: p.post_id,
      title: p.title,
      subreddit: p.subreddit,
      postedAt: p.posted_at,
      upvotes: p.upvotes,
      landings: Number(p.landings),
      inferred: Number(p.inferred),
    })),
  }
}

export type DeepLinkDetail = NonNullable<Awaited<ReturnType<typeof deepLinkDetail>>>
