import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ResolvedRange } from '@/lib/time'
import { linkAttribution } from './reddit-links'
import { redditSubsByAccount, tracedByRedditAccount, type FanFilter } from './traced-revenue'
import { clicksByRedditAccount } from './clicks'

/**
 * Per-account performance for the accounts actually in rotation, grouped by the
 * poster who holds them.
 *
 * One row per Reddit account, because the account is the unit the team thinks
 * in: it fronts one model, one poster works it, and it lives or dies on its own
 * numbers. Rolling straight up to a VA total hides the account that stopped
 * producing three weeks ago.
 */

export interface AccountPerfRow {
  accountId: string
  username: string
  modelLabel: string
  posts: number
  removed: number
  removalRate: number | null
  avgUpvotes: number | null
  /** null when the account has no tracking link of its own — see linkAttribution */
  clicks: number | null
  /**
   * The link's running total. Shown when a window figure is not yet possible:
   * neither OnlyFans nor OnlyMonster reports clicks by date, so a window needs
   * two readings of the counter, and a dash tells the team nothing about a link
   * that has had six thousand clicks.
   */
  lifetimeClicks: number | null
  subs: number | null
  revenueCents: number | null
  /** how many OnlyFans tracking links point at this account */
  linkCount: number
}

export interface PosterGroup {
  posterId: string
  posterName: string
  accounts: AccountPerfRow[]
  posts: number
  removed: number
  clicks: number
  subs: number
  revenueCents: number
  avgUpvotes: number | null
  /** accounts in this group with no tracking link, whose contribution is unmeasurable */
  untracked: number
}

export async function accountPerformance(
  range: ResolvedRange,
  attributionWindowH = 72,
  posterIds?: string[],
  fans: FanFilter = 'all',
): Promise<PosterGroup[]> {
  const accounts = await prisma.redditAccount.findMany({
    where: {
      assignedPosterId: posterIds?.length ? { in: posterIds } : { not: null },
      status: { not: 'RETIRED' },
    },
    orderBy: { username: 'asc' },
    select: {
      id: true,
      username: true,
      modelLabel: true,
      assignedPoster: { select: { id: true, name: true } },
      assignedCreator: { select: { stageName: true } },
    },
  })
  if (!accounts.length) return []
  const ids = accounts.map((a) => a.id)

  const [postRows, links, traced, subsBy, clicksBy] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        account_id: string
        posts: bigint
        removed: bigint
        upvotes: bigint
      }>
    >(Prisma.sql`
      SELECT "redditAccountId" AS account_id,
             COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed,
             COALESCE(SUM("latestUpvotes"), 0) AS upvotes
      FROM "Post"
      WHERE "redditAccountId" = ANY(${ids})
        AND "postedAt" >= ${range.start} AND "postedAt" < ${range.end}
      GROUP BY 1
    `),
    // clicks and subs come from the tracking-link counters; revenue is traced
    // through the fans those links brought, never apportioned from a total
    linkAttribution(range.start, range.end),
    tracedByRedditAccount(range.start, range.end, fans),
    redditSubsByAccount(range.start, range.end),
    clicksByRedditAccount(range.start, range.end),
  ])

  void attributionWindowH

  const postBy = new Map(postRows.map((r) => [r.account_id, r]))
  const linkBy = new Map<
    string,
    { clicks: number | null; subs: number | null; lifetimeClicks: number; links: number }
  >()
  for (const l of links) {
    if (!l.redditAccountId) continue
    const a = linkBy.get(l.redditAccountId) ?? {
      clicks: null,
      subs: null,
      lifetimeClicks: 0,
      links: 0,
    }
    if (l.clicks != null) a.clicks = (a.clicks ?? 0) + l.clicks
    if (l.subs != null) a.subs = (a.subs ?? 0) + l.subs
    a.lifetimeClicks += l.lifetimeClicks
    a.links++
    linkBy.set(l.redditAccountId, a)
  }

  const groups = new Map<string, PosterGroup>()

  for (const a of accounts) {
    if (!a.assignedPoster) continue
    const p = postBy.get(a.id)
    const posts = Number(p?.posts ?? 0)
    const removed = Number(p?.removed ?? 0)
    const upvotes = Number(p?.upvotes ?? 0)
    const link = linkBy.get(a.id)

    const row: AccountPerfRow = {
      accountId: a.id,
      username: a.username,
      modelLabel: a.modelLabel ?? a.assignedCreator?.stageName ?? '—',
      posts,
      removed,
      removalRate: posts ? removed / posts : null,
      avgUpvotes: posts ? Math.round(upvotes / posts) : null,
      // bouncy first: it is the only click source that answers for a period
      clicks: clicksBy.has(a.id) ? (clicksBy.get(a.id) ?? 0) : link ? link.clicks : null,
      lifetimeClicks: link ? link.lifetimeClicks : null,
      // counted from the fans themselves, so a window needs no prior reading
      subs: link ? (subsBy.get(a.id) ?? 0) : null,
      revenueCents: link ? (traced.get(a.id) ?? 0) : null,
      linkCount: link?.links ?? 0,
    }

    const g = groups.get(a.assignedPoster.id) ?? {
      posterId: a.assignedPoster.id,
      posterName: a.assignedPoster.name,
      accounts: [],
      posts: 0,
      removed: 0,
      clicks: 0,
      subs: 0,
      revenueCents: 0,
      avgUpvotes: null,
      untracked: 0,
    }

    g.accounts.push(row)
    g.posts += row.posts
    g.removed += row.removed
    g.clicks += row.clicks ?? 0
    g.subs += row.subs ?? 0
    g.revenueCents += row.revenueCents ?? 0
    if (row.linkCount === 0) g.untracked++
    groups.set(a.assignedPoster.id, g)
  }

  // the group average is upvotes over posts, not the mean of the per-account
  // averages — an account with one lucky post should not swing the total
  for (const g of groups.values()) {
    const totalUpvotes = g.accounts.reduce((s, r) => s + (r.avgUpvotes ?? 0) * r.posts, 0)
    g.avgUpvotes = g.posts ? Math.round(totalUpvotes / g.posts) : null
  }

  return [...groups.values()].sort((a, b) => a.posterName.localeCompare(b.posterName))
}
