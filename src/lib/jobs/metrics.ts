import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'
import { markRemoved } from './removal'

/**
 * Job 2 — post metrics.
 *
 * Cadence, from postedAt:
 *   < 6h      every 15 min
 *   6h – 24h  hourly
 *   24h – 7d  every 6h
 *   > 7d      stop
 *
 * Every capture appends a PostMetric row. Nothing is ever overwritten, which is
 * what lets you plot an upvote curve and see a post die three hours after it
 * peaked instead of just seeing a low final number.
 *
 * Removal detection is folded in here rather than run as a second job over the
 * same posts: we already hold a fresh snapshot, and paying twice for the same
 * fetch would come straight out of the polling budget. The standalone removal
 * job handles posts that have aged out of this window.
 */
export async function runPostMetrics(opts: { limit?: number; postIds?: string[] } = {}) {
  return runJob('POST_METRICS', null, async (ctx): Promise<JobResult> => {
    const config = await getJobConfig('POST_METRICS')
    if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

    const provider = redditProvider()
    const now = new Date()
    const limit = opts.limit ?? Number(process.env.METRICS_BATCH ?? 250)

    const due = opts.postIds
      ? await prisma.post.findMany({
          where: { id: { in: opts.postIds } },
          select: {
            id: true,
            redditPostId: true,
            postedAt: true,
            latestUpvotes: true,
            latestComments: true,
            posterId: true,
          },
        })
      : await prisma.$queryRaw<
          Array<{
            id: string
            redditPostId: string
            postedAt: Date
            latestUpvotes: number
            latestComments: number
            posterId: string | null
          }>
        >(Prisma.sql`
          SELECT id, "redditPostId", "postedAt", "latestUpvotes", "latestComments", "posterId"
          FROM "Post"
          WHERE status = 'LIVE'
            AND "postedAt" > ${new Date(now.getTime() - 7 * 86_400_000)}
            AND (
              "lastMetricAt" IS NULL
              OR ("postedAt" >  ${new Date(now.getTime() - 6 * 3_600_000)}
                  AND "lastMetricAt" < ${new Date(now.getTime() - 15 * 60_000)})
              OR ("postedAt" <= ${new Date(now.getTime() - 6 * 3_600_000)}
                  AND "postedAt" > ${new Date(now.getTime() - 24 * 3_600_000)}
                  AND "lastMetricAt" < ${new Date(now.getTime() - 3_600_000)})
              OR ("postedAt" <= ${new Date(now.getTime() - 24 * 3_600_000)}
                  AND "lastMetricAt" < ${new Date(now.getTime() - 6 * 3_600_000)})
            )
          ORDER BY "postedAt" DESC
          LIMIT ${limit}
        `)

    let captured = 0
    let removals = 0
    let errors = 0
    let lastError: string | null = null

    for (const post of due) {
      try {
        const snapshot = await provider.getPost(post.redditPostId)

        // Three independent removal signatures. The third one matters most:
        // a post whose score collapses to 1 while its comments survive has been
        // pulled, even when the API still happily serves it.
        const scoreCollapse =
          snapshot.upvotes <= 1 && post.latestUpvotes > 5 && snapshot.comments >= 3
        if (snapshot.missing || snapshot.removed || snapshot.deleted || scoreCollapse) {
          await markRemoved({
            postId: post.id,
            posterId: post.posterId,
            deleted: snapshot.deleted,
            reason:
              snapshot.removalReason ??
              (scoreCollapse
                ? 'Score collapsed to 1 with comments intact'
                : 'Not returned by the API'),
            observedComments: snapshot.comments || post.latestComments,
            at: now,
          })
          removals += 1
          captured += 1
          ctx.progress(captured, errors)
          continue
        }

        await prisma.$transaction([
          prisma.postMetric.create({
            data: {
              postId: post.id,
              capturedAt: now,
              upvotes: snapshot.upvotes,
              upvoteRatio: snapshot.upvoteRatio,
              comments: snapshot.comments,
            },
          }),
          prisma.post.update({
            where: { id: post.id },
            data: {
              lastMetricAt: now,
              latestUpvotes: snapshot.upvotes,
              latestComments: snapshot.comments,
              latestUpvoteRatio: snapshot.upvoteRatio,
            },
          }),
        ])
        captured += 1
      } catch (err) {
        errors += 1
        lastError = err instanceof Error ? `${post.redditPostId}: ${err.message}` : String(err)
      }
      ctx.progress(captured, errors)
    }

    return {
      itemsProcessed: captured,
      errorsCount: errors,
      lastError,
      detail: { removals, due: due.length, provider: provider.name },
    }
  })
}
