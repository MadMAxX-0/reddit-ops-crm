import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { runJob, type JobResult } from './runner'

/**
 * Learns which subreddits accept this kind of content by reading where other
 * accounts post.
 *
 * The team's subreddit list used to be whatever someone remembered. This builds
 * it from evidence: watch a handful of accounts working the same niche, record
 * every subreddit they post into, and rank by how many different accounts are
 * doing it and how well those posts do.
 *
 * Nothing is written to the working subreddit list. A discovery is a candidate;
 * promoting one is a decision someone makes on the screen.
 */
export async function runSubredditDiscovery(opts: { targetIds?: string[] } = {}) {
  return runJob('SUBREDDIT_RULES', null, async (ctx): Promise<JobResult> => {
    const provider = redditProvider()
    const targets = await prisma.scrapeTarget.findMany({
      where: { active: true, ...(opts.targetIds?.length ? { id: { in: opts.targetIds } } : {}) },
      orderBy: { lastScrapedAt: 'asc' },
    })

    let items = 0
    let errors = 0
    let lastError: string | null = null
    let discovered = 0

    for (const target of targets) {
      try {
        // Two views, because neither alone is enough. The submission listing is
        // authoritative about posts but truncates brutally — u/SableSizzle has
        // 1.27M link karma and it returns ONE row, a profile post, which left
        // discovery reporting a busy account as dead. The overview returns
        // posts and comments together and found nine subreddits for the same
        // account. Reading both and merging is the only way to see the account.
        const [posts, overview] = await Promise.all([
          provider.listAccountSubmissions(target.username),
          provider.getUserOverview
            ? provider.getUserOverview(target.username).catch(() => [])
            : Promise.resolve([]),
        ])

        // a target's own profile page is not a subreddit anyone can post to
        const isReal = (name: string) => !name.toLowerCase().startsWith('u_')
        const real = posts.filter((p) => isReal(p.subreddit))

        const bySub = new Map<
          string,
          { posts: number; comments: number; total: number; best: number; last: Date | null }
        >()
        const at = (name: string) => {
          const acc = bySub.get(name) ?? { posts: 0, comments: 0, total: 0, best: 0, last: null }
          bySub.set(name, acc)
          return acc
        }
        for (const p of real) {
          const acc = at(p.subreddit)
          acc.posts++
          acc.total += p.upvotes
          acc.best = Math.max(acc.best, p.upvotes)
          if (!acc.last || p.postedAt > acc.last) acc.last = p.postedAt
        }
        // the overview may repeat a post the listing already gave us, so its
        // posts only count where the listing saw nothing for that subreddit
        for (const o of overview) {
          if (!isReal(o.subreddit)) continue
          const acc = at(o.subreddit)
          if (o.isPost) {
            if (acc.posts === 0) {
              acc.posts++
              acc.total += o.score
              acc.best = Math.max(acc.best, o.score)
              if (!acc.last || o.createdAt > acc.last) acc.last = o.createdAt
            }
          } else {
            acc.comments++
          }
        }
        const seen = real.length + overview.filter((o) => isReal(o.subreddit)).length

        for (const [subreddit, acc] of bySub) {
          await prisma.subredditObservation.upsert({
            where: { targetId_subreddit: { targetId: target.id, subreddit } },
            create: {
              targetId: target.id,
              subreddit,
              posts: acc.posts,
              comments: acc.comments,
              totalScore: acc.total,
              bestScore: acc.best,
              lastPostAt: acc.last,
            },
            // a re-read of the same timeline replaces the counts rather than
            // adding to them, so re-running never inflates anything
            update: {
              posts: acc.posts,
              comments: acc.comments,
              totalScore: acc.total,
              bestScore: acc.best,
              lastPostAt: acc.last,
            },
          })
        }

        await prisma.scrapeTarget.update({
          where: { id: target.id },
          data: {
            lastScrapedAt: new Date(),
            postsSeen: seen,
            // only a genuinely empty read is an error. An account that comments
            // and never posts is normal, and calling that "suspended" sent a
            // real, working account to the bottom of the screen in red.
            lastError:
              seen === 0
                ? 'nothing returned — suspended, renamed, private, or the listing is empty again'
                : null,
          },
        })
        items += seen
      } catch (err) {
        errors++
        lastError = `${target.username}: ${err instanceof Error ? err.message : String(err)}`
        await prisma.scrapeTarget.update({
          where: { id: target.id },
          data: { lastScrapedAt: new Date(), lastError },
        })
      }
      ctx.progress(items, errors)
    }

    // roll the per-target observations up into the candidate list
    const rollup = await prisma.subredditObservation.groupBy({
      by: ['subreddit'],
      _sum: { posts: true, comments: true, totalScore: true },
      _max: { bestScore: true, lastPostAt: true },
      _count: { targetId: true },
    })

    for (const r of rollup) {
      const posts = r._sum.posts ?? 0
      await prisma.discoveredSubreddit.upsert({
        where: { name: r.subreddit },
        create: {
          name: r.subreddit,
          posts,
          comments: r._sum.comments ?? 0,
          targets: r._count.targetId,
          avgScore: posts ? Math.round((r._sum.totalScore ?? 0) / posts) : 0,
          bestScore: r._max.bestScore ?? 0,
          lastPostAt: r._max.lastPostAt,
        },
        update: {
          posts,
          comments: r._sum.comments ?? 0,
          targets: r._count.targetId,
          avgScore: posts ? Math.round((r._sum.totalScore ?? 0) / posts) : 0,
          bestScore: r._max.bestScore ?? 0,
          lastPostAt: r._max.lastPostAt,
        },
      })
      discovered++
    }

    return {
      itemsProcessed: items,
      errorsCount: errors,
      lastError,
      detail: { targets: targets.length, postsRead: items, subreddits: discovered },
    }
  })
}
