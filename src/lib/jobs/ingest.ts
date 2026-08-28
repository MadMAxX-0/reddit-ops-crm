import { prisma } from '@/lib/prisma'
import type { MediaType, PollTier, Prisma } from '@/generated/prisma/client'
import type { PostSnapshot } from '@/lib/reddit'
import { DEFAULT_TIER_INTERVALS_SEC } from './config'
import { classifyRemoval } from '@/lib/reddit/removal-cause'

/**
 * Shared ingestion path. Both discovery and any future backfill go through
 * here so the attribution rules can only be written once.
 */

export interface TierIntervals {
  hotIntervalSec: number
  warmIntervalSec: number
  coldIntervalSec: number
  dormantIntervalSec: number
}

export function tierFor(
  lastPostAt: Date | null,
  hasAssignment: boolean,
  now = new Date(),
): PollTier {
  if (lastPostAt) {
    const ageMs = now.getTime() - lastPostAt.getTime()
    if (ageMs <= 86_400_000) return 'HOT'
    if (ageMs <= 7 * 86_400_000) return 'WARM'
  }
  return hasAssignment ? 'COLD' : 'DORMANT'
}

export function nextPollAt(tier: PollTier, intervals: TierIntervals, now = new Date()): Date {
  const sec =
    tier === 'HOT'
      ? intervals.hotIntervalSec
      : tier === 'WARM'
        ? intervals.warmIntervalSec
        : tier === 'COLD'
          ? intervals.coldIntervalSec
          : intervals.dormantIntervalSec
  // ±12% jitter so 2,500 accounts do not all come due in the same second
  const jittered = sec * (0.88 + Math.random() * 0.24)
  return new Date(now.getTime() + jittered * 1000)
}

export const DEFAULT_INTERVALS: TierIntervals = {
  hotIntervalSec: DEFAULT_TIER_INTERVALS_SEC.HOT,
  warmIntervalSec: DEFAULT_TIER_INTERVALS_SEC.WARM,
  coldIntervalSec: DEFAULT_TIER_INTERVALS_SEC.COLD,
  dormantIntervalSec: DEFAULT_TIER_INTERVALS_SEC.DORMANT,
}

/**
 * Resolve who a post belongs to from the assignment that was open at postedAt —
 * NOT from whoever holds the account today. This one lookup is the entire
 * reason AccountAssignment exists.
 */
export async function resolveAttribution(redditAccountId: string, postedAt: Date) {
  const assignment = await prisma.accountAssignment.findFirst({
    where: {
      redditAccountId,
      startedAt: { lte: postedAt },
      OR: [{ endedAt: null }, { endedAt: { gt: postedAt } }],
    },
    orderBy: { startedAt: 'desc' },
    select: { creatorId: true, posterId: true },
  })

  if (!assignment) {
    // Nobody held this account when the post was made. Do not guess and do not
    // drop it — unattributed posts are how VA numbers quietly go wrong.
    return { creatorId: null, posterId: null, attributionStatus: 'NEEDS_REVIEW' as const }
  }
  return { ...assignment, attributionStatus: 'RESOLVED' as const }
}

/** Subreddits we have never seen still need a row, or the post cannot land. */
export async function resolveSubreddit(name: string) {
  const existing = await prisma.subreddit.findUnique({ where: { name }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.subreddit.create({
    data: {
      name,
      tier: 'C',
      status: 'ACTIVE',
      rulesSummary: 'Discovered by the scraper. Rules not yet fetched.',
      // lastScrapedAt stays null so the weekly rules job picks it up first
    },
    select: { id: true },
  })
  return created.id
}

/**
 * An account that posted but is not in our inventory. We create a stub rather
 * than discarding the post, and flag it for the manager review queue.
 */
export async function resolveUnknownAccount(username: string) {
  const existing = await prisma.redditAccount.findUnique({
    where: { username },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await prisma.redditAccount.create({
    data: {
      username,
      passwordEnc: '',
      emailAddress: '',
      status: 'WARMING',
      pollTier: 'DORMANT',
      healthScore: 0,
      notes:
        'Discovered by the scraper — this account is not in our inventory. Confirm ownership or dismiss.',
    },
    select: { id: true },
  })
  return created.id
}

export interface IngestOutcome {
  inserted: boolean
  postId: string
  needsReview: boolean
}

/** Insert one discovered post plus its first metric snapshot. Idempotent. */
export async function ingestDiscoveredPost(
  snapshot: PostSnapshot,
  redditAccountId: string,
  now = new Date(),
): Promise<IngestOutcome | null> {
  const existing = await prisma.post.findUnique({
    where: { redditPostId: snapshot.redditPostId },
    select: { id: true, attributionStatus: true },
  })
  if (existing) {
    return {
      inserted: false,
      postId: existing.id,
      needsReview: existing.attributionStatus === 'NEEDS_REVIEW',
    }
  }

  const [subredditId, attribution] = await Promise.all([
    resolveSubreddit(snapshot.subreddit),
    resolveAttribution(redditAccountId, snapshot.postedAt),
  ])

  const data: Prisma.PostUncheckedCreateInput = {
    redditPostId: snapshot.redditPostId,
    redditAccountId,
    subredditId,
    creatorId: attribution.creatorId,
    posterId: attribution.posterId,
    title: snapshot.title,
    flair: snapshot.flair,
    mediaType: snapshot.mediaType as MediaType,
    url: snapshot.url,
    mediaUrl: snapshot.mediaUrl,
    thumbnailUrl: snapshot.thumbnailUrl,
    selftext: snapshot.selftext,
    postedAt: snapshot.postedAt,
    // firstSeenAt minus postedAt IS the discovery lag we monitor
    firstSeenAt: now,
    status: snapshot.removed ? 'REMOVED' : snapshot.deleted ? 'DELETED' : 'LIVE',
    removedBy: classifyRemoval(
      snapshot.removalReason,
      snapshot.removed ? 'REMOVED' : snapshot.deleted ? 'DELETED' : 'LIVE',
    ),
    attributionStatus: attribution.attributionStatus,
    removedAt: snapshot.removed ? now : null,
    removalReason: snapshot.removalReason,
    lastMetricAt: now,
    latestUpvotes: snapshot.upvotes,
    latestComments: snapshot.comments,
    latestUpvoteRatio: snapshot.upvoteRatio,
  }

  try {
    const post = await prisma.post.create({ data })
    await prisma.postMetric.create({
      data: {
        postId: post.id,
        capturedAt: now,
        upvotes: snapshot.upvotes,
        upvoteRatio: snapshot.upvoteRatio,
        comments: snapshot.comments,
      },
    })
    return {
      inserted: true,
      postId: post.id,
      needsReview: attribution.attributionStatus === 'NEEDS_REVIEW',
    }
  } catch (err) {
    // two workers can race on the same post; the unique index is the referee
    if (
      typeof err === 'object' &&
      err &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      const row = await prisma.post.findUnique({
        where: { redditPostId: snapshot.redditPostId },
        select: { id: true, attributionStatus: true },
      })
      return row
        ? { inserted: false, postId: row.id, needsReview: row.attributionStatus === 'NEEDS_REVIEW' }
        : null
    }
    throw err
  }
}
