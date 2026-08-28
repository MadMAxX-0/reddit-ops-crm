import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { conversionsByPostCte } from './attribution-sql'
import type { Ctx } from '@/lib/session'
import { IN_ROTATION } from './rotation'

/**
 * Everything on the Posting page is guidance before the fact or observation
 * after it. There is no data entry: a poster's daily count comes entirely from
 * what the scraper discovered, so there is no form to pad.
 */

export type BlockReason =
  'VERIFICATION' | 'KARMA' | 'AGE' | 'COOLDOWN' | 'SUBREDDIT_STATUS' | 'ACCOUNT_STATUS'

export interface Eligibility {
  subredditId: string
  subredditName: string
  tier: string
  eligible: boolean
  reason: BlockReason | null
  detail: string | null
  /** when a cooldown lifts; null when it is not a cooldown block */
  nextEligibleAt: Date | null
  /** expected value of posting here, from the last 30 days of our own results */
  score: number
  medianUpvotes: number | null
  removalRate: number | null
}

export interface PlanAccount {
  id: string
  username: string
  status: string
  healthScore: number
  ageDays: number
  karmaPost: number
  shadowbanned: boolean
  creatorName: string | null
  slug: string | null
  funnelUrl: string | null
  postsToday: number
  eligible: Eligibility[]
  blocked: Eligibility[]
}

const REASON_ORDER: BlockReason[] = [
  'ACCOUNT_STATUS',
  'SUBREDDIT_STATUS',
  'VERIFICATION',
  'AGE',
  'KARMA',
  'COOLDOWN',
]

export async function todaysPlan(
  ctx: Ctx,
  posterId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<PlanAccount[]> {
  const now = new Date()

  const [accounts, subreddits] = await Promise.all([
    prisma.redditAccount.findMany({
      where: {
        assignedPosterId: posterId,
        status: { in: ['ACTIVE', 'READY', 'SHADOWBANNED'] },
      },
      orderBy: [{ healthScore: 'desc' }],
      select: {
        id: true,
        username: true,
        status: true,
        healthScore: true,
        karmaPost: true,
        redditCreatedAt: true,
        verifiedSubreddits: true,
        shadowbanned: true,
        assignedCreator: { select: { stageName: true } },
        trackedLinks: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { slug: true, funnelUrl: true },
        },
      },
    }),
    prisma.subreddit.findMany({
      where: { status: { not: 'BANNED_FOR_US' } },
      orderBy: [{ tier: 'asc' }, { subscribers: 'desc' }],
      select: {
        id: true,
        name: true,
        tier: true,
        status: true,
        verificationRequired: true,
        minKarma: true,
        minAccountAgeDays: true,
        postCooldownHours: true,
      },
    }),
  ])

  const accountIds = accounts.map((a) => a.id)
  if (!accountIds.length) return []

  // Rank openings by what each subreddit has actually returned for us lately,
  // so the plan reads as a shortlist rather than a wall of every legal option.
  const perf = await subredditPerformance()

  // last post per (account, subreddit) — this is what makes the cooldown real
  // rather than a rule nobody can check
  const lastPosts = await prisma.post.groupBy({
    by: ['redditAccountId', 'subredditId'],
    where: {
      redditAccountId: { in: accountIds },
      postedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
    },
    _max: { postedAt: true },
  })
  const lastPostAt = new Map(
    lastPosts.map((p) => [`${p.redditAccountId}:${p.subredditId}`, p._max.postedAt!]),
  )

  const todayCounts = await prisma.post.groupBy({
    by: ['redditAccountId'],
    where: {
      redditAccountId: { in: accountIds },
      postedAt: { gte: dayStart, lt: dayEnd },
    },
    _count: { _all: true },
  })
  const postsToday = new Map(todayCounts.map((c) => [c.redditAccountId, c._count._all]))

  return accounts.map((account) => {
    const ageDays = account.redditCreatedAt
      ? Math.floor((now.getTime() - account.redditCreatedAt.getTime()) / 86_400_000)
      : 0

    const rows: Eligibility[] = subreddits.map((sub) => {
      const p = perf.get(sub.id)
      const base = {
        subredditId: sub.id,
        subredditName: sub.name,
        tier: sub.tier as string,
        score: p?.score ?? 0,
        medianUpvotes: p?.medianUpvotes ?? null,
        removalRate: p?.removalRate ?? null,
      }

      if (account.status === 'SHADOWBANNED' || account.shadowbanned) {
        return {
          ...base,
          eligible: false,
          reason: 'ACCOUNT_STATUS' as const,
          detail: 'Account is shadowbanned',
          nextEligibleAt: null,
        }
      }
      if (sub.status === 'RISKY') {
        // risky is a warning, not a block — it still shows in eligible with a note
      }
      if (sub.verificationRequired && !account.verifiedSubreddits.includes(sub.name)) {
        return {
          ...base,
          eligible: false,
          reason: 'VERIFICATION' as const,
          detail: 'Not verified here',
          nextEligibleAt: null,
        }
      }
      if (ageDays < sub.minAccountAgeDays) {
        return {
          ...base,
          eligible: false,
          reason: 'AGE' as const,
          detail: `${ageDays}d old, needs ${sub.minAccountAgeDays}d`,
          nextEligibleAt: account.redditCreatedAt
            ? new Date(account.redditCreatedAt.getTime() + sub.minAccountAgeDays * 86_400_000)
            : null,
        }
      }
      if (account.karmaPost < sub.minKarma) {
        return {
          ...base,
          eligible: false,
          reason: 'KARMA' as const,
          detail: `${account.karmaPost} karma, needs ${sub.minKarma}`,
          nextEligibleAt: null,
        }
      }
      const last = lastPostAt.get(`${account.id}:${sub.id}`)
      if (last) {
        const free = new Date(last.getTime() + sub.postCooldownHours * 3_600_000)
        if (free > now) {
          return {
            ...base,
            eligible: false,
            reason: 'COOLDOWN' as const,
            detail: `posted ${Math.round((now.getTime() - last.getTime()) / 3_600_000)}h ago`,
            nextEligibleAt: free,
          }
        }
      }
      return {
        ...base,
        eligible: true,
        reason: null,
        detail: sub.status === 'RISKY' ? 'Risky — high removal rate' : null,
        nextEligibleAt: null,
      }
    })

    const eligible = rows
      .filter((r) => r.eligible)
      .sort((a, b) => b.score - a.score || a.tier.localeCompare(b.tier))

    const blocked = rows
      .filter((r) => !r.eligible)
      .sort(
        (a, b) =>
          REASON_ORDER.indexOf(a.reason!) - REASON_ORDER.indexOf(b.reason!) ||
          (a.nextEligibleAt?.getTime() ?? Infinity) - (b.nextEligibleAt?.getTime() ?? Infinity),
      )

    return {
      id: account.id,
      username: account.username,
      status: account.status,
      healthScore: account.healthScore,
      ageDays,
      karmaPost: account.karmaPost,
      shadowbanned: account.shadowbanned,
      creatorName: account.assignedCreator?.stageName ?? null,
      slug: account.trackedLinks[0]?.slug ?? null,
      funnelUrl: account.trackedLinks[0]?.funnelUrl ?? null,
      postsToday: postsToday.get(account.id) ?? 0,
      eligible,
      blocked,
    }
  })
}

/** Account × subreddit heatmap of when each pairing is next eligible. */
export async function cooldownMatrix(posterId: string, limitAccounts = 40) {
  const now = new Date()
  const [accounts, subreddits] = await Promise.all([
    prisma.redditAccount.findMany({
      where: { assignedPosterId: posterId, status: { in: ['ACTIVE', 'READY'] } },
      orderBy: { healthScore: 'desc' },
      take: limitAccounts,
      select: {
        id: true,
        username: true,
        karmaPost: true,
        redditCreatedAt: true,
        verifiedSubreddits: true,
      },
    }),
    prisma.subreddit.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ tier: 'asc' }, { subscribers: 'desc' }],
      take: 24,
      select: {
        id: true,
        name: true,
        tier: true,
        postCooldownHours: true,
        verificationRequired: true,
        minKarma: true,
        minAccountAgeDays: true,
      },
    }),
  ])

  const ids = accounts.map((a) => a.id)
  const lastPosts = ids.length
    ? await prisma.post.groupBy({
        by: ['redditAccountId', 'subredditId'],
        where: {
          redditAccountId: { in: ids },
          postedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
        },
        _max: { postedAt: true },
      })
    : []
  const lastPostAt = new Map(
    lastPosts.map((p) => [`${p.redditAccountId}:${p.subredditId}`, p._max.postedAt!]),
  )

  const cells = accounts.map((a) => {
    const ageDays = a.redditCreatedAt
      ? Math.floor((now.getTime() - a.redditCreatedAt.getTime()) / 86_400_000)
      : 0
    return {
      accountId: a.id,
      username: a.username,
      cells: subreddits.map((s) => {
        if (s.verificationRequired && !a.verifiedSubreddits.includes(s.name)) {
          return { subredditId: s.id, state: 'ineligible' as const, hours: null }
        }
        if (a.karmaPost < s.minKarma || ageDays < s.minAccountAgeDays) {
          return { subredditId: s.id, state: 'ineligible' as const, hours: null }
        }
        const last = lastPostAt.get(`${a.id}:${s.id}`)
        if (!last) return { subredditId: s.id, state: 'ready' as const, hours: 0 }
        const freeInH =
          (last.getTime() + s.postCooldownHours * 3_600_000 - now.getTime()) / 3_600_000
        return freeInH <= 0
          ? { subredditId: s.id, state: 'ready' as const, hours: 0 }
          : { subredditId: s.id, state: 'cooling' as const, hours: Math.ceil(freeInH) }
      }),
    }
  })

  return { subreddits, rows: cells }
}

/** Read-only feed of what the scraper found for this VA in the window. */
export async function discoveredFeed(
  ctx: Ctx,
  posterId: string | null,
  from: Date,
  to: Date,
  limit = 300,
) {
  const posts = await prisma.post.findMany({
    where: {
      postedAt: { gte: from, lt: to },
      ...(posterId ? { posterId } : {}),
      ...(ctx.isManager ? {} : { posterId: ctx.user.id }),
    },
    orderBy: { postedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      postedAt: true,
      firstSeenAt: true,
      status: true,
      url: true,
      latestUpvotes: true,
      latestComments: true,
      removalReason: true,
      attributionStatus: true,
      subreddit: { select: { name: true, tier: true } },
      redditAccount: { select: { id: true, username: true } },
      creator: { select: { stageName: true } },
      poster: { select: { name: true } },
    },
  })

  const lags = posts
    .map((p) => (p.firstSeenAt.getTime() - p.postedAt.getTime()) / 60_000)
    .sort((a, b) => a - b)

  return {
    posts,
    medianLagMin: lags.length ? Math.round(lags[Math.floor(lags.length / 2)]) : null,
    removed: posts.filter((p) => p.status === 'REMOVED').length,
  }
}

/**
 * Per-subreddit expected value over the last 30 days, from our own posts only.
 *
 * The score deliberately punishes removals rather than just rewarding reach: a
 * subreddit that gives 400 upvotes and pulls a third of what you send is worth
 * less than one giving 150 that leaves them up.
 */
export async function subredditPerformance() {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const rows = await prisma.$queryRaw<
    Array<{
      subreddit_id: string
      posts: bigint
      removed: bigint
      median_upvotes: number | null
      landings: bigint
      revenue_cents: bigint
    }>
  >(Prisma.sql`
    WITH p AS (
      SELECT "subredditId",
             COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latestUpvotes") AS median_upvotes
      FROM "Post"
      WHERE "postedAt" >= ${since}
      GROUP BY 1
    ),
    f AS (
      SELECT po."subredditId",
             COUNT(*) FILTER (WHERE fe.type = 'LANDED' AND NOT fe."isBot") AS landings
      FROM "FunnelEvent" fe
      JOIN "Post" po ON po.id = fe."attributedPostId"
      WHERE fe.ts >= ${since}
      GROUP BY 1
    ),
    c AS (
      ${conversionsByPostCte(since, new Date(), 72, 'subredditId')}
    )
    SELECT p."subredditId" AS subreddit_id, p.posts, p.removed, p.median_upvotes,
           COALESCE(f.landings, 0) AS landings,
           COALESCE(c.revenue_cents, 0) AS revenue_cents
    FROM p
    LEFT JOIN f ON f."subredditId" = p."subredditId"
    LEFT JOIN c ON c.group_id = p."subredditId"
  `)

  const out = new Map<
    string,
    { score: number; medianUpvotes: number | null; removalRate: number | null }
  >()
  for (const r of rows) {
    const posts = Number(r.posts)
    if (!posts) continue
    const removalRate = Number(r.removed) / posts
    const revenuePerPost = Number(r.revenue_cents) / posts
    const landingsPerPost = Number(r.landings) / posts
    // revenue dominates when we have it; landings stand in for young subreddits
    const score = (revenuePerPost + landingsPerPost * 4) * (1 - Math.min(0.9, removalRate))
    out.set(r.subreddit_id, {
      score,
      medianUpvotes: r.median_upvotes == null ? null : Math.round(Number(r.median_upvotes)),
      removalRate,
    })
  }
  return out
}

export interface TopPost {
  id: string
  title: string
  url: string | null
  subreddit: string
  username: string
  modelLabel: string | null
  upvotes: number
  comments: number
  status: string
  postedAt: Date
  mediaType: string
  /** the media itself, so the post can be looked at, not just counted */
  mediaUrl: string | null
  thumbnailUrl: string | null
  selftext: string | null
}

/**
 * The posts that did best in a window, across every account.
 *
 * Ranked on upvotes, and it has to be said plainly why: no revenue figure
 * exists per post. Money is traced to the FAN who paid and the link they came
 * through, and a link is shared by every post an account ever made — so there
 * is no honest way to say which post earned a given dollar. Ranking these by
 * revenue would mean inventing an attribution, which this product does not do.
 *
 * Upvotes are the strongest signal that survives: a post nobody upvoted was
 * seen by nobody, and a post that did numbers is the one worth repeating.
 */
export async function topPosts(
  start: Date,
  end: Date,
  limit = 8,
  creatorIds?: string[],
): Promise<TopPost[]> {
  const posts = await prisma.post.findMany({
    where: {
      postedAt: { gte: start, lt: end },
      ...IN_ROTATION,
      ...(creatorIds?.length ? { creatorId: { in: creatorIds } } : {}),
    },
    orderBy: [{ latestUpvotes: 'desc' }, { latestComments: 'desc' }],
    take: limit,
    select: {
      id: true,
      title: true,
      url: true,
      status: true,
      postedAt: true,
      latestUpvotes: true,
      latestComments: true,
      mediaType: true,
      mediaUrl: true,
      thumbnailUrl: true,
      selftext: true,
      subreddit: { select: { name: true } },
      redditAccount: { select: { username: true, modelLabel: true } },
    },
  })

  return posts.map((p) => ({
    id: p.id,
    title: p.title,
    url: p.url,
    subreddit: p.subreddit.name,
    username: p.redditAccount.username,
    modelLabel: p.redditAccount.modelLabel,
    upvotes: p.latestUpvotes,
    comments: p.latestComments,
    status: p.status,
    postedAt: p.postedAt,
    mediaType: p.mediaType,
    mediaUrl: p.mediaUrl,
    thumbnailUrl: p.thumbnailUrl,
    selftext: p.selftext,
  }))
}
