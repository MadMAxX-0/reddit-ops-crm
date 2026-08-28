import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { fetchSubmissionsRss, RssRateLimited, type FeedSort } from '@/lib/reddit/rss'

/**
 * Read what the accounts we watch are posting.
 *
 * Same two-source split the CRM's own discovery uses: Reddit's feed says WHICH
 * posts exist — nothing else will, for an NSFW account — and the API supplies
 * the score for each one. Neither is asked to do the other's job.
 *
 * Paced deliberately. Reddit throttles the feed and answers 429 rather than
 * degrading, so a throttle is waited out and never recorded as "they posted
 * nothing", which is the mistake that cost this project a fortnight of posts.
 */
const GAP_MS = Number(process.env.REDDIT_RSS_GAP_MS ?? 6_000)

export async function runSpy(
  opts: { usernames?: string[]; withScores?: boolean; topToo?: boolean } = {},
) {
  const targets = await prisma.scrapeTarget.findMany({
    where: opts.usernames?.length
      ? {
          OR: opts.usernames.map((u) => ({
            username: { equals: u, mode: 'insensitive' as const },
          })),
        }
      : { active: true },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  })

  const provider = redditProvider()
  type FeedRow = Awaited<ReturnType<typeof fetchSubmissionsRss>>[number]
  const feedRows: FeedRow[] = []
  let inserted = 0
  let seen = 0
  const failures: string[] = []

  for (const t of targets) {
    // Both passes: what they are posting now, and what has ever worked for
    // them. A feed is 25 entries either way, so the two together reach months
    // back instead of days — which is the difference between a swipe file and
    // a list of this week.
    const passes: FeedSort[] = opts.topToo === false ? ['new'] : ['new', 'top']
    const collected = new Map<string, FeedRow>()
    let anyAnswer = false

    for (const sort of passes) {
      let feed: Awaited<ReturnType<typeof fetchSubmissionsRss>> | null = null
      let wait = 4_000
      for (let attempt = 0; attempt < 5 && feed === null; attempt++) {
        try {
          feed = await fetchSubmissionsRss(t.username, sort, 'all')
        } catch (err) {
          if (err instanceof RssRateLimited) {
            await new Promise((r) => setTimeout(r, wait))
            wait = Math.min(wait * 2, 60_000)
            continue
          }
          // A 403 here is the account being banned, which is worth recording as
          // the reason rather than as a silent zero.
          failures.push(`${t.username}: ${err instanceof Error ? err.message : String(err)}`)
          break
        }
      }
      if (feed) {
        anyAnswer = true
        for (const f of feed) collected.set(f.redditPostId, f)
      }
      await new Promise((r) => setTimeout(r, GAP_MS))
    }

    const feed = anyAnswer ? [...collected.values()] : null

    if (!feed) {
      await prisma.scrapeTarget.update({
        where: { id: t.id },
        data: { lastScrapedAt: new Date(), lastError: 'no answer from feed' },
      })
      continue
    }

    seen += feed.length
    const known = new Set(
      (
        await prisma.targetPost.findMany({
          where: { redditPostId: { in: feed.map((f) => f.redditPostId) } },
          select: { redditPostId: true },
        })
      ).map((p) => p.redditPostId),
    )

    for (const f of feed) {
      if (known.has(f.redditPostId)) {
        // Already stored, but a row saved before the feed parser learned to read
        // media has no picture. Fill it in rather than leaving the swipe file
        // half blind — this is a write only while something is actually missing.
        if (f.thumbnailUrl || f.mediaUrl) {
          await prisma.targetPost.updateMany({
            where: {
              redditPostId: f.redditPostId,
              OR: [{ thumbnailUrl: null }, { mediaUrl: null }],
            },
            data: {
              ...(f.thumbnailUrl ? { thumbnailUrl: f.thumbnailUrl } : {}),
              ...(f.mediaUrl ? { mediaUrl: f.mediaUrl } : {}),
            },
          })
        }
        continue
      }
      let score = 0
      let comments = 0
      if (opts.withScores !== false) {
        try {
          const d = await provider.getPost(f.redditPostId)
          if (!d.missing) {
            score = d.upvotes ?? 0
            comments = d.comments ?? 0
          }
        } catch {
          // the post is still worth recording without its numbers
        }
      }
      await prisma.targetPost.create({
        data: {
          targetId: t.id,
          redditPostId: f.redditPostId,
          subreddit: f.subreddit || 'unknown',
          title: f.title.slice(0, 300),
          url: f.url,
          thumbnailUrl: f.thumbnailUrl,
          mediaUrl: f.mediaUrl,
          postedAt: f.postedAt,
          score,
          comments,
          lastMetricAt: new Date(),
        },
      })
      inserted += 1
    }

    // Roll the per-subreddit view up from what we just read, so the scraper's
    // existing "where do they post" screen stays in step.
    const bySub = new Map<string, { posts: number; total: number; best: number; last: Date }>()
    for (const f of feed) {
      const cur = bySub.get(f.subreddit) ?? { posts: 0, total: 0, best: 0, last: f.postedAt }
      cur.posts += 1
      if (f.postedAt > cur.last) cur.last = f.postedAt
      bySub.set(f.subreddit, cur)
    }
    for (const [subreddit, v] of bySub) {
      await prisma.subredditObservation.upsert({
        where: { targetId_subreddit: { targetId: t.id, subreddit } },
        update: { posts: v.posts, lastPostAt: v.last },
        create: { targetId: t.id, subreddit, posts: v.posts, lastPostAt: v.last },
      })
    }

    // Karma comes from the profile endpoint, which answers reliably even when
    // listings do not. Keeping the previous reading beside it is what lets the
    // table show movement instead of a standing total.
    let karma: number | null = null
    try {
      const acct = await provider.getAccount(t.username)
      if (acct.exists) karma = (acct.karmaPost ?? 0) + (acct.karmaComment ?? 0)
    } catch {
      // leave the last known reading alone rather than zeroing it
    }

    const prev = await prisma.scrapeTarget.findUniqueOrThrow({
      where: { id: t.id },
      select: { karma: true },
    })

    await prisma.scrapeTarget.update({
      where: { id: t.id },
      data: {
        lastScrapedAt: new Date(),
        postsSeen: feed.length,
        lastError: null,
        ...(karma !== null && karma !== prev.karma
          ? { karma, karmaPrev: prev.karma, karmaCheckedAt: new Date() }
          : {}),
      },
    })

    await new Promise((r) => setTimeout(r, GAP_MS))
  }

  return { targets: targets.length, seen, inserted, failures }
}
