import { prisma } from '@/lib/prisma'
import { clicksByRedditAccount } from '@/lib/queries/clicks'
import { redditSubsByAccount } from '@/lib/queries/traced-revenue'
import type { RemovedBy } from '@/generated/prisma/client'
import { IN_ROTATION, ROTATION_ACCOUNT } from './rotation'

/**
 * The accounts actually in rotation, grouped by the VA who works them.
 *
 * The full database answers "what do we own". This answers "what is working,
 * and who is working it" — which is the question a manager opens the CRM to
 * ask. An account is in rotation when `pipelineStage` is ACTIVE; everything it
 * posts is its output.
 *
 * Grouped by poster rather than by model because the VA is the unit of
 * accountability: a model with three accounts across two VAs tells you nothing
 * about who to talk to.
 */
export type Window = '24h' | '7d' | '30d'
const HOURS: Record<Window, number> = { '24h': 24, '7d': 168, '30d': 720 }
const WINDOWS: Window[] = ['24h', '7d', '30d']

/**
 * Everything in here describes ONE window. Splitting a row across two — posts
 * for the last 7 days beside removals for the last 30 — produced rows reading
 * "21 posted, 22 live", which is not a rounding quirk, it is a row that cannot
 * be true. Whatever window is selected, every number in the row is that window.
 */
export interface WindowCell {
  posts: number
  live: number
  byMod: number
  byReddit: number
  byAuthor: number
  unknown: number
  upvotes: number
  /** replies our post drew */
  comments: number
  /** comments this account LEFT elsewhere — the farming work */
  commentsMade: number
  commentKarma: number
  avgUpvotes: number
  clicks: number
  subs: number
}

export interface RosterPost {
  id: string
  subreddit: string
  title: string
  url: string | null
  thumbnailUrl: string | null
  mediaUrl: string | null
  score: number
  comments: number
  postedAt: Date
  status: string
  /** MOD / REDDIT / AUTHOR / UNKNOWN, null while it is live */
  removedBy: string | null
}

export interface RosterAccount {
  id: string
  username: string
  status: string
  /** BANNED / SHADOWBANNED once raised, never cleared */
  flag: string | null
  model: string | null
  karmaPost: number
  karmaComment: number
  ageDays: number | null
  lastPostAt: Date | null
  /** the account's own posts — best ever and newest, for the expanded row */
  best: RosterPost[]
  latest: RosterPost[]
  /**
   * Karma moved but no post was found. With NSFW timelines no longer listed by
   * the host, this is the only remaining evidence that an account posted, so it
   * is shown rather than buried: a count that is quietly short is worse than
   * one that admits its own gap.
   */
  suspectedMissedPosts: number
  windows: Record<Window, WindowCell>
}

export interface RosterGroup {
  vaId: string
  vaName: string
  accounts: RosterAccount[]
  /** group totals, one set per window, so the header follows the toggle too */
  windows: Record<
    Window,
    {
      posts: number
      live: number
      clicks: number
      subs: number
      upvotes: number
      commentsMade: number
      survival: number | null
    }
  >
  /** accounts nobody can reach — suspended outright */
  dead: number
}

const BUCKET: Record<RemovedBy, 'byMod' | 'byReddit' | 'byAuthor' | 'unknown'> = {
  MOD: 'byMod',
  REDDIT: 'byReddit',
  AUTHOR: 'byAuthor',
  UNKNOWN: 'unknown',
}

export async function activeRoster(now = new Date()) {
  const since = (w: Window) => new Date(now.getTime() - HOURS[w] * 3_600_000)
  const oldest = since('30d')

  // Clicks and arrivals are counted per window rather than derived from a 30d
  // total, because neither divides evenly: a link keeps taking hits long after
  // the post that carried it, and a fan can arrive weeks after the click.
  const [accounts, posts, history, comments, clicks24, clicks7, clicks30, subs24, subs7, subs30] =
    await Promise.all([
      prisma.redditAccount.findMany({
        where: ROTATION_ACCOUNT,
        select: {
          id: true,
          username: true,
          status: true,
          flag: true,
          karmaPost: true,
          karmaComment: true,
          redditCreatedAt: true,
          lastPostAt: true,
          suspectedMissedPosts: true,
          assignedCreator: { select: { stageName: true } },
          assignedPoster: { select: { id: true, name: true } },
        },
        orderBy: { username: 'asc' },
      }),
      prisma.post.findMany({
        where: { postedAt: { gte: oldest }, ...IN_ROTATION },
        select: {
          redditAccountId: true,
          postedAt: true,
          status: true,
          removedBy: true,
          latestUpvotes: true,
          latestComments: true,
        },
      }),
      // The 30-day slice above answers "how is this week going". This answers
      // "what has ever worked for this account", which is a different question
      // and needs the whole history, not a window.
      prisma.post.findMany({
        where: { redditAccount: ROTATION_ACCOUNT },
        orderBy: { postedAt: 'desc' },
        take: 2000,
        select: {
          id: true,
          redditAccountId: true,
          title: true,
          url: true,
          mediaUrl: true,
          thumbnailUrl: true,
          latestUpvotes: true,
          latestComments: true,
          postedAt: true,
          status: true,
          removedBy: true,
          subreddit: { select: { name: true } },
        },
      }),
      prisma.redditComment.findMany({
        where: { postedAt: { gte: oldest }, redditAccount: ROTATION_ACCOUNT },
        select: { redditAccountId: true, postedAt: true, score: true },
      }),
      clicksByRedditAccount(since('24h'), now),
      clicksByRedditAccount(since('7d'), now),
      clicksByRedditAccount(oldest, now),
      redditSubsByAccount(since('24h'), now),
      redditSubsByAccount(since('7d'), now),
      redditSubsByAccount(oldest, now),
    ])

  const clicksBy: Record<Window, Map<string, number>> = {
    '24h': clicks24,
    '7d': clicks7,
    '30d': clicks30,
  }
  const subsBy: Record<Window, Map<string, number>> = { '24h': subs24, '7d': subs7, '30d': subs30 }

  const emptyCell = (): WindowCell => ({
    posts: 0,
    live: 0,
    byMod: 0,
    byReddit: 0,
    byAuthor: 0,
    unknown: 0,
    upvotes: 0,
    comments: 0,
    commentsMade: 0,
    commentKarma: 0,
    avgUpvotes: 0,
    clicks: 0,
    subs: 0,
  })

  const byId = new Map<string, RosterAccount>()
  for (const a of accounts) {
    byId.set(a.id, {
      id: a.id,
      username: a.username,
      status: a.status,
      flag: a.flag ?? null,
      model: a.assignedCreator?.stageName ?? null,
      karmaPost: a.karmaPost,
      karmaComment: a.karmaComment,
      ageDays: a.redditCreatedAt
        ? Math.floor((now.getTime() - a.redditCreatedAt.getTime()) / 86_400_000)
        : null,
      lastPostAt: a.lastPostAt,
      suspectedMissedPosts: a.suspectedMissedPosts,
      best: [],
      latest: [],
      windows: { '24h': emptyCell(), '7d': emptyCell(), '30d': emptyCell() },
    })
  }

  for (const p of posts) {
    const row = byId.get(p.redditAccountId)
    if (!row) continue
    const ageH = (now.getTime() - p.postedAt.getTime()) / 3_600_000
    for (const w of WINDOWS) {
      if (ageH > HOURS[w]) continue
      const c = row.windows[w]
      c.posts += 1
      if (p.status === 'LIVE') c.live += 1
      else if (p.removedBy) c[BUCKET[p.removedBy]] += 1
      else c.unknown += 1
      c.upvotes += p.latestUpvotes ?? 0
      c.comments += p.latestComments ?? 0
    }
  }

  for (const c of comments) {
    const row = byId.get(c.redditAccountId)
    if (!row) continue
    const ageH = (now.getTime() - c.postedAt.getTime()) / 3_600_000
    for (const w of WINDOWS) {
      if (ageH > HOURS[w]) continue
      row.windows[w].commentsMade += 1
      row.windows[w].commentKarma += c.score ?? 0
    }
  }

  for (const [id, row] of byId) {
    for (const w of WINDOWS) {
      const c = row.windows[w]
      c.avgUpvotes = c.posts ? Math.round(c.upvotes / c.posts) : 0
      c.clicks = clicksBy[w].get(id) ?? 0
      c.subs = subsBy[w].get(id) ?? 0
    }
  }

  // Two lists per account, from the same history. Sorting one list two ways
  // would let "best ever" only ever surface the best of the newest few.
  const shape = (p: (typeof history)[number]): RosterPost => ({
    id: p.id,
    subreddit: p.subreddit?.name ?? 'unknown',
    title: p.title,
    url: p.url,
    thumbnailUrl: p.thumbnailUrl,
    mediaUrl: p.mediaUrl,
    score: p.latestUpvotes ?? 0,
    comments: p.latestComments ?? 0,
    postedAt: p.postedAt,
    status: p.status,
    removedBy: p.removedBy,
  })
  const byAccount = new Map<string, typeof history>()
  for (const p of history) {
    const list = byAccount.get(p.redditAccountId) ?? []
    list.push(p)
    byAccount.set(p.redditAccountId, list)
  }
  for (const [id, list] of byAccount) {
    const row = byId.get(id)
    if (!row) continue
    row.latest = list.slice(0, 20).map(shape)
    row.best = [...list]
      .sort((a, b) => (b.latestUpvotes ?? 0) - (a.latestUpvotes ?? 0))
      .slice(0, 20)
      .map(shape)
  }

  const groups = new Map<string, RosterGroup>()
  for (const a of accounts) {
    const key = a.assignedPoster?.id ?? '__none'
    if (!groups.has(key)) {
      groups.set(key, {
        vaId: key,
        vaName: a.assignedPoster?.name ?? 'No VA assigned',
        accounts: [],
        windows: {
          '24h': {
            posts: 0,
            live: 0,
            clicks: 0,
            subs: 0,
            upvotes: 0,
            commentsMade: 0,
            survival: null,
          },
          '7d': {
            posts: 0,
            live: 0,
            clicks: 0,
            subs: 0,
            upvotes: 0,
            commentsMade: 0,
            survival: null,
          },
          '30d': {
            posts: 0,
            live: 0,
            clicks: 0,
            subs: 0,
            upvotes: 0,
            commentsMade: 0,
            survival: null,
          },
        },
        dead: 0,
      })
    }
    const g = groups.get(key)!
    const row = byId.get(a.id)!
    g.accounts.push(row)
    for (const w of WINDOWS) {
      const t = g.windows[w]
      const c = row.windows[w]
      t.posts += c.posts
      t.live += c.live
      t.clicks += c.clicks
      t.subs += c.subs
      t.upvotes += c.upvotes
      t.commentsMade += c.commentsMade
    }
    if (row.status === 'SUSPENDED') g.dead += 1
  }

  const list = [...groups.values()].map((g) => {
    for (const w of WINDOWS) {
      const t = g.windows[w]
      t.survival = t.posts ? t.live / t.posts : null
    }
    return {
      ...g,
      accounts: g.accounts.sort((a, b) => b.windows['30d'].posts - a.windows['30d'].posts),
    }
  })
  list.sort((a, b) =>
    a.vaId === '__none'
      ? 1
      : b.vaId === '__none'
        ? -1
        : b.windows['30d'].posts - a.windows['30d'].posts,
  )

  // Totals per window, not a fixed 30 days. The tiles sit directly above a
  // table that follows the toggle, and a header describing a different period
  // to the rows beneath it is how "21 posted, 22 live" happened.
  const totals = {
    accounts: list.reduce((n, g) => n + g.accounts.length, 0),
    dead: list.reduce((n, g) => n + g.dead, 0),
    windows: Object.fromEntries(
      WINDOWS.map((w) => [
        w,
        list.reduce(
          (t, g) => ({
            posts: t.posts + g.windows[w].posts,
            live: t.live + g.windows[w].live,
            clicks: t.clicks + g.windows[w].clicks,
            subs: t.subs + g.windows[w].subs,
          }),
          { posts: 0, live: 0, clicks: 0, subs: 0 },
        ),
      ]),
    ) as Record<Window, { posts: number; live: number; clicks: number; subs: number }>,
  }

  return { groups: list, totals }
}
