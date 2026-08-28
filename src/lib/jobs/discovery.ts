import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'
import {
  ingestDiscoveredPost,
  nextPollAt,
  resolveUnknownAccount,
  tierFor,
  type TierIntervals,
} from './ingest'
import { notifyManagers } from './notify'
import { fetchSubmissionsRss, RssRateLimited } from '@/lib/reddit/rss'
import type { PostSnapshot } from '@/lib/reddit/types'

/**
 * Job 1 — post discovery. The most important job in the system.
 *
 * Polls each account's submitted timeline, diffs against known redditPostIds
 * and inserts anything new. Subreddit, title, flair, media type and postedAt
 * all come from the scrape; creator and poster are resolved from
 * AccountAssignment as of postedAt.
 *
 * Accounts are polled on a tier, not a single interval, because the polling
 * budget is the real constraint:
 *
 *   HOT      posted in the last 24h      every 10 min
 *   WARM     posted in the last 7d       hourly
 *   COLD     assigned, no post in 7d     every 6h
 *   DORMANT  warming or unassigned       daily
 *
 * An account moves to HOT the moment a post is discovered.
 */
export async function runPostDiscovery(opts: { limit?: number; accountIds?: string[] } = {}) {
  return runJob(
    'POST_DISCOVERY',
    opts.accountIds?.join(',') ?? null,
    async (ctx): Promise<JobResult> => {
      const config = await getJobConfig('POST_DISCOVERY')
      if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

      const intervals: TierIntervals = {
        hotIntervalSec: config.hotIntervalSec,
        warmIntervalSec: config.warmIntervalSec,
        coldIntervalSec: config.coldIntervalSec,
        dormantIntervalSec: config.dormantIntervalSec,
      }

      const provider = redditProvider()
      const now = new Date()
      const limit = opts.limit ?? Number(process.env.DISCOVERY_BATCH ?? 120)

      const accounts = await prisma.redditAccount.findMany({
        where: opts.accountIds
          ? { id: { in: opts.accountIds } }
          : {
              status: { notIn: ['SUSPENDED', 'RETIRED'] },
              OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
            },
        // hot accounts first: a due HOT account is a post we are already late for
        orderBy: [{ pollTier: 'asc' }, { nextPollAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          username: true,
          lastPostAt: true,
          historyWalkedAt: true,
          pollTier: true,
          assignments: { where: { endedAt: null }, select: { id: true }, take: 1 },
        },
      })

      let polled = 0
      let inserted = 0
      let needsReview = 0
      let errors = 0
      let lastError: string | null = null
      const lags: number[] = []

      for (const account of accounts) {
        try {
          // Only ask for what we might not have. On a hot account that is one
          // request.
          //
          // An account whose history has never been walked gets NO floor at
          // all. The old code used 45 days here, and because `since` only ever
          // moves forward, anything older than a first poll was unreachable
          // forever — u/No_Oven8872 had 4,560 post karma and zero recorded
          // posts because its four submissions were from eight months earlier.
          // Farming accounts earn their karma months before rotation, so the
          // window was excluding precisely the accounts it mattered for.
          const firstWalk = !account.historyWalkedAt
          const since = firstWalk
            ? undefined
            : account.lastPostAt
              ? new Date(account.lastPostAt.getTime() - 60_000)
              : new Date(now.getTime() - 45 * 86_400_000)

          // Reddit's own feed first. It is the only source that reliably says
          // WHICH posts an account made — the listing API answers
          // `success: true` with an empty array for accounts posting several
          // times a day, and it cost this operation 159 posts before anyone
          // noticed. The API is still used below for the numbers on each post,
          // which it serves without complaint.
          let submissions: PostSnapshot[] = []
          let viaFeed = false
          try {
            // Reddit throttles the feed and answers 429 rather than degrading.
            // A throttle is not an empty timeline, so it is waited out — the
            // first version fell straight through to the API on the first 429
            // and recovered nothing, which is the whole failure this was meant
            // to fix.
            let feed: Awaited<ReturnType<typeof fetchSubmissionsRss>> = []
            let wait = 4_000
            for (let attempt = 0; attempt < 4; attempt++) {
              try {
                feed = await fetchSubmissionsRss(account.username)
                break
              } catch (err) {
                if (!(err instanceof RssRateLimited)) throw err
                await new Promise((r) => setTimeout(r, wait))
                wait = Math.min(wait * 2, 45_000)
              }
            }
            if (feed.length) {
              viaFeed = true
              submissions = feed
                .filter((f) => !since || f.postedAt >= since)
                .map((f) => ({
                  redditPostId: f.redditPostId,
                  subreddit: f.subreddit || 'unknown',
                  title: f.title,
                  url: f.url,
                  postedAt: f.postedAt,
                  author: account.username,
                  mediaType: 'LINK',
                  upvotes: 0,
                  comments: 0,
                  upvoteRatio: 0,
                  removed: false,
                  deleted: false,
                  removalReason: null,
                  missing: false,
                  flair: null,
                  mediaUrl: null,
                  thumbnailUrl: null,
                  selftext: null,
                }))
            }
          } catch {
            // 429 or a network blip. Not evidence of an empty timeline — fall
            // through and let the API try.
          }

          if (!viaFeed) {
            submissions = await provider.listAccountSubmissions(
              account.username,
              since,
              firstWalk ? 10 : 4,
            )
          }
          polled += 1

          const ids = submissions.map((s) => s.redditPostId)
          const known = ids.length
            ? new Set(
                (
                  await prisma.post.findMany({
                    where: { redditPostId: { in: ids } },
                    select: { redditPostId: true },
                  })
                ).map((p) => p.redditPostId),
              )
            : new Set<string>()

          let newestPostAt = account.lastPostAt

          for (const snapshot of submissions) {
            if (known.has(snapshot.redditPostId)) continue

            // the timeline can legitimately carry a different author when a
            // provider returns cross-posts; never file it under the wrong account
            const ownerId =
              snapshot.author && snapshot.author !== account.username
                ? await resolveUnknownAccount(snapshot.author)
                : account.id

            // The feed carries no score. Ask the API for it — it serves any
            // individual post by URL even when it refuses to list them.
            let enriched = snapshot
            if (viaFeed) {
              try {
                const detail = await provider.getPost(snapshot.redditPostId)
                if (!detail.missing) {
                  enriched = {
                    ...detail,
                    postedAt: snapshot.postedAt,
                    subreddit: snapshot.subreddit,
                  }
                }
              } catch {
                // record it anyway: knowing the post exists beats waiting
              }
            }

            const outcome = await ingestDiscoveredPost(enriched, ownerId, now)
            if (!outcome?.inserted) continue

            inserted += 1
            if (outcome.needsReview) needsReview += 1
            lags.push((now.getTime() - snapshot.postedAt.getTime()) / 60_000)
            if (ownerId === account.id && (!newestPostAt || snapshot.postedAt > newestPostAt)) {
              newestPostAt = snapshot.postedAt
            }
          }

          const tier = tierFor(newestPostAt, account.assignments.length > 0, now)
          await prisma.redditAccount.update({
            where: { id: account.id },
            data: {
              lastPolledAt: now,
              lastPostAt: newestPostAt,
              pollTier: tier,
              nextPollAt: nextPollAt(tier, intervals, now),
              // stamped even when the walk found nothing: it was still walked,
              // and re-walking every poll would cost 10 requests an account
              ...(firstWalk ? { historyWalkedAt: now } : {}),
            },
          })
        } catch (err) {
          errors += 1
          lastError = err instanceof Error ? `${account.username}: ${err.message}` : String(err)
          // back off this account rather than hammering a failing endpoint
          await prisma.redditAccount.update({
            where: { id: account.id },
            data: { lastPolledAt: now, nextPollAt: new Date(now.getTime() + 15 * 60_000) },
          })
        }
        ctx.progress(polled, errors)
      }

      if (needsReview > 0) {
        await notifyManagers({
          severity: 'WARN',
          title: `${needsReview} discovered post${needsReview === 1 ? '' : 's'} need attribution`,
          body: 'Found on accounts with no assignment at postedAt. They are not counted for any VA until resolved.',
          href: '/posting/attribution',
          entityType: 'Post',
        })
      }

      const medianLag = lags.length
        ? Math.round(lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)])
        : 0

      return {
        itemsProcessed: polled,
        errorsCount: errors,
        lastError,
        detail: {
          inserted,
          needsReview,
          medianLagMin: medianLag,
          provider: provider.name,
        },
      }
    },
  )
}
