import { prisma } from '@/lib/prisma'
import { IN_ROTATION } from './rotation'

/**
 * What the posting actually produced on Reddit itself: how many went out, how
 * much karma they drew, how much conversation they started.
 *
 * These are the only three numbers on the dashboard that owe nothing to
 * OnlyFans. Clicks, fans and revenue all die the moment a link is untracked or
 * a model is unconnected; posts, upvotes and comments are read straight off
 * Reddit and are the same whether or not any money has been traced yet.
 *
 * Counted by when the post went OUT, so the window describes the work done in
 * it. Upvotes and comments are the latest reading on those posts, which means a
 * post keeps accruing after its window closes — the alternative is snapshotting
 * every post every day, which `PostMetric` does for the ones worth charting but
 * not for every post ever made.
 */
export interface PostEngagement {
  posts: number
  upvotes: number
  comments: number
  /** posts still live — the rest were removed or deleted */
  live: number
}

export async function postEngagement(
  start: Date,
  end: Date,
  creatorIds?: string[],
): Promise<PostEngagement> {
  const where = {
    postedAt: { gte: start, lt: end },
    ...IN_ROTATION,
    ...(creatorIds?.length ? { creatorId: { in: creatorIds } } : {}),
  }

  const [agg, live] = await Promise.all([
    prisma.post.aggregate({
      where,
      _count: { _all: true },
      _sum: { latestUpvotes: true, latestComments: true },
    }),
    prisma.post.count({ where: { ...where, status: 'LIVE' } }),
  ])

  return {
    posts: agg._count._all,
    upvotes: agg._sum.latestUpvotes ?? 0,
    comments: agg._sum.latestComments ?? 0,
    live,
  }
}

export interface PostDay {
  day: string
  posts: number
  comments: number
  /** rounded — a fractional upvote is noise on an axis */
  avgUpvotes: number
}

/**
 * Posts, comments and average upvotes per day, on the same calendar-day spine
 * the click and revenue series use so every panel lines up.
 *
 * Average rather than total upvotes because volume already has its own line:
 * a day with 20 posts and 400 upvotes and a day with 2 posts and 400 upvotes
 * are opposite outcomes, and only the average tells them apart.
 */
export async function postEngagementSeries(
  start: Date,
  end: Date,
  creatorIds?: string[],
): Promise<PostDay[]> {
  const rows = await prisma.post.findMany({
    where: {
      postedAt: { gte: start, lt: end },
      ...IN_ROTATION,
      ...(creatorIds?.length ? { creatorId: { in: creatorIds } } : {}),
    },
    select: { postedAt: true, latestUpvotes: true, latestComments: true },
  })

  const byDay = new Map<string, { posts: number; upvotes: number; comments: number }>()
  // Every day in the range exists, so a gap reads as a zero rather than as a
  // line hopping over the days nothing was posted.
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    byDay.set(d.toISOString().slice(0, 10), { posts: 0, upvotes: 0, comments: 0 })
  }
  for (const r of rows) {
    const key = r.postedAt.toISOString().slice(0, 10)
    const cell = byDay.get(key)
    if (!cell) continue
    cell.posts += 1
    cell.upvotes += r.latestUpvotes ?? 0
    cell.comments += r.latestComments ?? 0
  }

  return [...byDay.entries()].map(([day, c]) => ({
    day,
    posts: c.posts,
    comments: c.comments,
    avgUpvotes: c.posts ? Math.round(c.upvotes / c.posts) : 0,
  }))
}
