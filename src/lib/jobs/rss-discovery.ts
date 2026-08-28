import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { fetchSubmissionsRss, RssRateLimited } from '@/lib/reddit/rss'
import { ROTATION_ACCOUNT } from '@/lib/queries/rotation'
import { ingestDiscoveredPost } from './ingest'
import type { PostSnapshot } from '@/lib/reddit/types'

/**
 * Post discovery over Reddit's own Atom feed.
 *
 * Two sources, each doing the one thing it is good at:
 *
 *   RSS       enumerates. It is the only source that will say WHICH posts an
 *             account made — the API host answers empty for accounts posting
 *             daily, and reddit.com's JSON is 403 from here.
 *   provider  measures. Given a post it returns score, comments and removal
 *             state; the host serves any individual post by URL happily, it
 *             just refuses to list them.
 *
 * Slow on purpose. Reddit throttles the feed to roughly one call every few
 * seconds per IP and answers 429 rather than degrading, so accounts are walked
 * one at a time with a gap and a backoff. Thirteen accounts take a few minutes,
 * which is fine for something that runs on a schedule.
 */
const GAP_MS = Number(process.env.REDDIT_RSS_GAP_MS ?? 6_000)
const MAX_BACKOFF_MS = 120_000

export async function runRssDiscovery(
  opts: { usernames?: string[]; onProgress?: (line: string) => void } = {},
) {
  const accounts = await prisma.redditAccount.findMany({
    where: opts.usernames?.length
      ? {
          OR: opts.usernames.map((u) => ({
            username: { equals: u, mode: 'insensitive' as const },
          })),
        }
      : ROTATION_ACCOUNT,
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  })

  const provider = redditProvider()
  let seen = 0
  let inserted = 0
  let rateLimited = 0
  const failures: string[] = []

  for (const account of accounts) {
    let backoff = GAP_MS
    let submissions: Awaited<ReturnType<typeof fetchSubmissionsRss>> | null = null

    // Keep asking through 429s. A throttle is not an empty timeline.
    for (let attempt = 0; attempt < 6 && submissions === null; attempt++) {
      try {
        submissions = await fetchSubmissionsRss(account.username)
      } catch (err) {
        if (err instanceof RssRateLimited) {
          rateLimited += 1
          await new Promise((r) => setTimeout(r, backoff))
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
          continue
        }
        failures.push(`${account.username}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }
    if (!submissions) {
      opts.onProgress?.(`u/${account.username}: no answer`)
      continue
    }

    seen += submissions.length
    const ids = submissions.map((s) => s.redditPostId)
    const known = new Set(
      (
        await prisma.post.findMany({
          where: { redditPostId: { in: ids } },
          select: { redditPostId: true },
        })
      ).map((p) => p.redditPostId),
    )
    const fresh = submissions.filter((s) => !known.has(s.redditPostId))

    let added = 0
    for (const s of fresh) {
      // Ask the provider for the numbers. If it cannot answer, the post is
      // still recorded — knowing it exists beats waiting for a score.
      let snap: PostSnapshot | null = null
      try {
        snap = await provider.getPost(s.redditPostId)
      } catch {
        snap = null
      }
      const merged: PostSnapshot = {
        ...(snap ?? ({} as PostSnapshot)),
        redditPostId: s.redditPostId,
        subreddit: s.subreddit || snap?.subreddit || 'unknown',
        title: snap?.title || s.title,
        url: snap?.url || s.url,
        postedAt: s.postedAt,
        author: snap?.author ?? account.username,
        mediaType: snap?.mediaType ?? 'LINK',
        upvotes: snap?.upvotes ?? 0,
        comments: snap?.comments ?? 0,
        upvoteRatio: snap?.upvoteRatio ?? 0,
        removed: snap?.removed ?? false,
        deleted: snap?.deleted ?? false,
        removalReason: snap?.removalReason ?? null,
        missing: false,
      }
      const out = await ingestDiscoveredPost(merged, account.id)
      if (out?.inserted) added += 1
    }

    inserted += added
    if (added)
      opts.onProgress?.(`u/${account.username}: +${added} (feed had ${submissions.length})`)

    // Update the account's own newest-post marker from the feed, which is now
    // the authority on when it last posted.
    const newest = submissions.reduce<Date | null>(
      (a, s) => (!a || s.postedAt > a ? s.postedAt : a),
      null,
    )
    if (newest) {
      await prisma.redditAccount.update({
        where: { id: account.id },
        data: { lastPostAt: newest, lastPolledAt: new Date() },
      })
    }

    await new Promise((r) => setTimeout(r, GAP_MS))
  }

  return { accounts: accounts.length, seen, inserted, rateLimited, failures }
}
