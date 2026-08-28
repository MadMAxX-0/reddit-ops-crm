import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'
import { notify, notifyManagers } from './notify'

/** Health is a blend of survival odds, not a vanity score. */
export function computeHealthScore(input: {
  ageDays: number
  karmaPost: number
  verifiedCount: number
  removalRate30d: number | null
  shadowbanned: boolean
  suspended: boolean
}): number {
  if (input.suspended) return 0
  if (input.shadowbanned) return Math.min(20, 10 + input.verifiedCount)
  const base =
    22 +
    Math.min(24, input.ageDays / 8) +
    Math.min(20, input.karmaPost / 90) +
    Math.min(10, input.verifiedCount * 1.5)
  const penalty = input.removalRate30d != null ? input.removalRate30d * 40 : 0
  return Math.max(1, Math.min(99, Math.round(base - penalty)))
}

/**
 * Job 4 — account health. Daily per account: karma, age, suspension status.
 *
 * Two things here are not obvious:
 *
 * 1. Shadowban detection is switched off. It needed the subreddit's own /new
 *    listing as a second view, and the host no longer serves listings for NSFW
 *    subreddits — which is all of them here. See the block below.
 *
 * 2. Karma that moves without a matching discovered post means something was
 *    posted and removed before we ever polled. We cannot recover the post, so
 *    we count it as a suspected missed post rather than pretending the record
 *    is complete. Understating your own removal rate is worse than admitting a
 *    gap.
 */
export async function runAccountHealth(opts: { limit?: number; accountIds?: string[] } = {}) {
  return runJob('ACCOUNT_HEALTH', null, async (ctx): Promise<JobResult> => {
    const config = await getJobConfig('ACCOUNT_HEALTH')
    if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

    const provider = redditProvider()
    const now = new Date()

    // A suspended account always carries the banned flag. The detection branch
    // below sets it, but a status can also arrive by hand or by an older code
    // path, and an unflagged dead account sits in the pipeline looking workable.
    // Reconciling here means the flag can never drift from the status again.
    const repaired = await prisma.redditAccount.updateMany({
      where: { status: 'SUSPENDED', flag: { not: 'BANNED' } },
      data: { flag: 'BANNED' },
    })
    const limit = opts.limit ?? Number(process.env.HEALTH_BATCH ?? 200)
    const dueBefore = new Date(now.getTime() - 24 * 3_600_000)

    const accounts = await prisma.redditAccount.findMany({
      where: opts.accountIds
        ? { id: { in: opts.accountIds } }
        : {
            // A suspended account IS re-checked, just rarely. Excluding them
            // outright made the status a one-way door: the host answers "user
            // not found" transiently — the same failure its subreddit endpoint
            // has — so one bad reading retired an account permanently and
            // nothing ever looked again. u/FrostBeacon sat suspended while its
            // profile answered normally with 26 post and 72 comment karma.
            status: { not: 'RETIRED' },
            OR: [
              { lastCheckedAt: null },
              {
                status: 'SUSPENDED',
                lastCheckedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) },
              },
              { status: { not: 'SUSPENDED' }, lastCheckedAt: { lt: dueBefore } },
            ],
          },
      orderBy: { lastCheckedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        username: true,
        karmaPost: true,
        karmaComment: true,
        followers: true,
        redditCreatedAt: true,
        verifiedSubreddits: true,
        shadowbanned: true,
        status: true,
        lastCheckedAt: true,
        assignedPosterId: true,
      },
    })

    let checked = 0
    let suspended = 0
    let revived = 0
    let shadowbans = 0
    let missedSignals = 0
    let errors = 0
    let lastError: string | null = null

    for (const account of accounts) {
      try {
        const snapshot = await provider.getAccount(account.username)

        // One refusal is not proof. The host returns "user not found" for
        // accounts that answer normally moments later, so a second look is
        // taken before an account is written off — the same three-strike rule
        // the subreddit enricher needed for exactly the same reason.
        let gone = snapshot.suspended || !snapshot.exists
        if (gone) {
          await new Promise((r) => setTimeout(r, 1_500))
          const retry = await provider.getAccount(account.username)
          if (retry.exists && !retry.suspended) {
            gone = false
            Object.assign(snapshot, retry)
          }
        }

        if (gone) {
          await prisma.$transaction([
            prisma.redditAccount.update({
              where: { id: account.id },
              data: {
                status: 'SUSPENDED',
                suspendedAt: now,
                healthScore: 0,
                pollTier: 'DORMANT',
                lastCheckedAt: now,
                // the flag column is what the pipeline reads; setting status
                // without it left eighteen dead accounts looking unremarkable
                // in the queue a farmer works from
                flag: 'BANNED',
              },
            }),
            prisma.accountAssignment.updateMany({
              where: { redditAccountId: account.id, endedAt: null },
              data: { endedAt: now },
            }),
            prisma.accountHealthSnapshot.create({
              data: {
                redditAccountId: account.id,
                capturedAt: now,
                karmaPost: account.karmaPost,
                karmaComment: account.karmaComment,
                followers: account.followers,
                shadowbanned: account.shadowbanned,
                suspended: true,
                healthScore: 0,
              },
            }),
          ])
          suspended += 1
          await notify({
            userIds: account.assignedPosterId ? [account.assignedPosterId] : [],
            severity: 'CRITICAL',
            title: `u/${account.username} suspended`,
            body: 'The account is out of rotation. Its open assignment has been closed.',
            href: `/accounts?account=${account.id}`,
            entityType: 'RedditAccount',
            entityId: account.id,
          })
          checked += 1
          ctx.progress(checked, errors)
          continue
        }

        // The profile answered, so the account is not suspended. Restoring the
        // status matters more than it looks: SUSPENDED excludes an account from
        // post discovery, from the roster, and from every figure the dashboard
        // shows, so a stale one silently deletes a working account from the
        // operation. The BANNED flag is left standing — it is the history.
        if (account.status === 'SUSPENDED') {
          await prisma.redditAccount.update({
            where: { id: account.id },
            data: { status: 'ACTIVE', suspendedAt: null, pollTier: 'COLD', nextPollAt: now },
          })
          revived += 1
        }

        // --- suspected missed post -------------------------------------
        const karmaDelta = snapshot.karmaPost - account.karmaPost
        let missed = 0
        if (account.lastCheckedAt) {
          // Scale the threshold to the gap between checks. A fixed "+5 karma"
          // rule fires constantly on a weekly check and never on an hourly one.
          const hoursSince = (now.getTime() - account.lastCheckedAt.getTime()) / 3_600_000
          const idleDrift = Math.max(6, hoursSince * 0.6)
          if (karmaDelta > idleDrift) {
            const postsSince = await prisma.post.count({
              where: { redditAccountId: account.id, firstSeenAt: { gte: account.lastCheckedAt } },
            })
            if (postsSince === 0) missed = 1
          }
        }

        // --- shadowban detection is OFF ---------------------------------
        //
        // It compared an account's own post against the subreddit's /new
        // listing. That comparison is no longer possible: the host returns an
        // empty listing for every NSFW subreddit — 7 of 7 tested, 0 posts, while
        // 4 of 4 SFW subreddits returned 25 — and every subreddit this operation
        // posts to is NSFW. With the listing gone the check has no second view
        // to compare against, and what it produced instead was accounts marked
        // shadowbanned while pulling 128 upvotes and 19 comments on posts made
        // that morning.
        //
        // A wrong SHADOWBANNED is not a cosmetic error. The status removes the
        // account from the roster, from post discovery and from every number on
        // the dashboard, so a false positive deletes a working account from the
        // operation and nothing ever looks again.
        //
        // The flag stays available for a person to set by hand — the operator's
        // own sheet has a FLAG column and they use it. Automatic detection can
        // come back the day there is a second view to compare against: Reddit's
        // own API with OAuth would give one.
        const shadowbanned = false

        const removal = await prisma.post.groupBy({
          by: ['status'],
          where: {
            redditAccountId: account.id,
            postedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
          },
          _count: { _all: true },
        })
        const totalPosts = removal.reduce((s, r) => s + r._count._all, 0)
        const removedPosts = removal.find((r) => r.status === 'REMOVED')?._count._all ?? 0

        const ageDays = snapshot.createdAt
          ? (now.getTime() - snapshot.createdAt.getTime()) / 86_400_000
          : account.redditCreatedAt
            ? (now.getTime() - account.redditCreatedAt.getTime()) / 86_400_000
            : 0

        // A provider that cannot read the u_ subreddit reports 0. Writing that
        // through would look like the account lost every follower overnight, so
        // 0 is treated as "not reported" and the last known count is kept.
        const followers = snapshot.followers > 0 ? snapshot.followers : account.followers

        const healthScore = computeHealthScore({
          ageDays,
          karmaPost: snapshot.karmaPost,
          verifiedCount: account.verifiedSubreddits.length,
          removalRate30d: totalPosts ? removedPosts / totalPosts : null,
          shadowbanned,
          suspended: false,
        })

        await prisma.$transaction([
          prisma.redditAccount.update({
            where: { id: account.id },
            data: {
              karmaPost: snapshot.karmaPost,
              karmaComment: snapshot.karmaComment,
              followers,
              redditCreatedAt: snapshot.createdAt ?? account.redditCreatedAt,
              // shadowbanned / status / flag are deliberately not written here
              healthScore,
              lastCheckedAt: now,
              suspectedMissedPosts: { increment: missed },
            },
          }),
          prisma.accountHealthSnapshot.create({
            data: {
              redditAccountId: account.id,
              capturedAt: now,
              karmaPost: snapshot.karmaPost,
              karmaComment: snapshot.karmaComment,
              followers,
              shadowbanned,
              suspended: false,
              healthScore,
            },
          }),
        ])

        if (missed) missedSignals += 1
        if (shadowbanned && !account.shadowbanned) {
          shadowbans += 1
          await notify({
            userIds: account.assignedPosterId ? [account.assignedPosterId] : [],
            severity: 'CRITICAL',
            title: `u/${account.username} looks shadowbanned`,
            body: 'Its posts are visible on the profile but absent from the subreddit listing.',
            href: `/accounts?account=${account.id}`,
            entityType: 'RedditAccount',
            entityId: account.id,
          })
        }
        checked += 1
      } catch (err) {
        errors += 1
        lastError = err instanceof Error ? `${account.username}: ${err.message}` : String(err)
      }
      ctx.progress(checked, errors)
    }

    if (missedSignals >= 3) {
      await notifyManagers({
        severity: 'WARN',
        title: `${missedSignals} accounts gained karma with no discovered post`,
        body: 'Posts are being removed before discovery reaches them. Tighten the hot-tier interval or accept an understated removal rate.',
        href: '/admin/scraper',
        entityType: 'RedditAccount',
      })
    }

    return {
      itemsProcessed: checked,
      errorsCount: errors,
      lastError,
      detail: { suspended, revived, shadowbans, missedSignals, flagsRepaired: repaired.count },
    }
  })
}
