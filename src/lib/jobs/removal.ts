import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'
import { notify, notifyManagers } from './notify'
import { classifyRemoval } from '@/lib/reddit/removal-cause'

/**
 * Mark a post removed and tell the people who need to know. Idempotent: a post
 * already marked removed is left alone rather than re-notified every 15 minutes.
 */
export async function markRemoved(opts: {
  postId: string
  posterId: string | null
  deleted: boolean
  reason: string
  observedComments: number
  at?: Date
}) {
  const at = opts.at ?? new Date()
  const current = await prisma.post.findUnique({
    where: { id: opts.postId },
    select: {
      status: true,
      title: true,
      posterId: true,
      subreddit: { select: { name: true } },
    },
  })
  if (!current || current.status !== 'LIVE') return false

  await prisma.$transaction([
    prisma.post.update({
      where: { id: opts.postId },
      data: {
        status: opts.deleted ? 'DELETED' : 'REMOVED',
        removedAt: at,
        removalReason: opts.reason.slice(0, 300),
        removedBy: classifyRemoval(opts.reason, opts.deleted ? 'DELETED' : 'REMOVED'),
        lastMetricAt: at,
        latestUpvotes: 1,
        latestComments: opts.observedComments,
      },
    }),
    // the collapse itself is a data point, so it goes on the curve
    prisma.postMetric.create({
      data: {
        postId: opts.postId,
        capturedAt: at,
        upvotes: 1,
        upvoteRatio: 0.5,
        comments: opts.observedComments,
      },
    }),
  ])

  if (!opts.deleted) {
    const who = opts.posterId ?? current.posterId
    await notify({
      userIds: who ? [who] : [],
      severity: 'WARN',
      title: `Post removed in r/${current.subreddit.name}`,
      body: `${current.title.slice(0, 120)} — ${opts.reason}`,
      href: '/posting',
      entityType: 'Post',
      entityId: opts.postId,
    })
  }
  return true
}

/**
 * Job 3 — removal detection for posts that have aged out of the metrics window.
 *
 * The metrics job already catches removals in the first seven days from the
 * snapshot it is fetching anyway. This job exists for the long tail: a post
 * quietly pulled on day nine still needs to move out of the LIVE count, or the
 * removal rate reads better than it is.
 */
export async function runRemovalDetection(opts: { limit?: number } = {}) {
  return runJob('REMOVAL_DETECTION', null, async (ctx): Promise<JobResult> => {
    const config = await getJobConfig('REMOVAL_DETECTION')
    if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

    const provider = redditProvider()
    const now = new Date()
    const limit = opts.limit ?? Number(process.env.REMOVAL_BATCH ?? 120)

    const candidates = await prisma.$queryRaw<
      Array<{
        id: string
        redditPostId: string
        latestUpvotes: number
        latestComments: number
        posterId: string | null
        missStreak: number
      }>
    >(Prisma.sql`
      SELECT id, "redditPostId", "latestUpvotes", "latestComments", "posterId", "missStreak"
      FROM "Post"
      WHERE status = 'LIVE'
        AND "postedAt" <= ${new Date(now.getTime() - 7 * 86_400_000)}
        AND "postedAt" >  ${new Date(now.getTime() - 30 * 86_400_000)}
        AND ("lastMetricAt" IS NULL OR "lastMetricAt" < ${new Date(now.getTime() - 3 * 86_400_000)})
      ORDER BY "lastMetricAt" ASC NULLS FIRST
      LIMIT ${limit}
    `)

    // Reconcile first. A post can reach REMOVED through more than one path, and
    // any row written before `removedBy` existed carries a reason with no
    // classification. Reading the reason back is cheap and means the cause
    // columns can never quietly drift from the status.
    const stale = await prisma.post.findMany({
      where: { status: { in: ['REMOVED', 'DELETED'] }, removedBy: null },
      select: { id: true, status: true, removalReason: true },
      take: 500,
    })
    for (const p of stale) {
      const v = classifyRemoval(p.removalReason, p.status)
      if (v) await prisma.post.update({ where: { id: p.id }, data: { removedBy: v } })
    }

    let checked = 0
    let removals = 0
    let errors = 0
    let lastError: string | null = null

    for (const post of candidates) {
      try {
        const snapshot = await provider.getPost(post.redditPostId)

        // A 404 is not proof the post is gone, and a retry seconds later is not
        // a second opinion — the host 404s live posts in streaks lasting
        // minutes, so both attempts land inside the same streak. Two rounds of
        // this cost 7 false removals out of 11 in a single three-hour window.
        //
        // So a miss is counted, not acted on. Three separate job runs have to
        // fail to see the post before it is written off, and any successful
        // read resets the count. Nothing else in this job treats an absence as
        // an answer.
        if (snapshot.missing) {
          const streak = post.missStreak + 1
          await prisma.post.update({
            where: { id: post.id },
            data: { missStreak: streak, lastMetricAt: now },
          })
          if (streak < 3) {
            checked += 1
            ctx.progress(checked, errors)
            continue
          }
        } else if (post.missStreak > 0) {
          await prisma.post.update({ where: { id: post.id }, data: { missStreak: 0 } })
        }

        // The same caution for the score-collapse heuristic. It reads a crashed
        // score as a silent removal, and a failed fetch also reports zero — so
        // it only counts when the post came back at all.
        const scoreCollapse =
          !snapshot.missing &&
          snapshot.upvotes <= 1 &&
          post.latestUpvotes > 5 &&
          snapshot.comments >= 3

        if (snapshot.missing || snapshot.removed || snapshot.deleted || scoreCollapse) {
          const did = await markRemoved({
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
          if (did) removals += 1
        } else {
          // touch lastMetricAt so the sweep moves on rather than looping
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
        }
        checked += 1
      } catch (err) {
        errors += 1
        lastError = err instanceof Error ? `${post.redditPostId}: ${err.message}` : String(err)
      }
      ctx.progress(checked, errors)
    }

    // A removal spike is a signal about a subreddit, not about one post, so it
    // goes to managers rather than to whoever happened to post last.
    if (removals >= 5) {
      await notifyManagers({
        severity: 'CRITICAL',
        title: `${removals} posts removed in one sweep`,
        body: 'Check the subreddit breakdown before sending more volume there.',
        href: '/overview',
        entityType: 'Post',
      })
    }

    return { itemsProcessed: checked, errorsCount: errors, lastError, detail: { removals } }
  })
}
