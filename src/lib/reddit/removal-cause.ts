import type { RemovedBy } from '@/generated/prisma/client'

/**
 * Classify Reddit's `removed_by_category` into who actually took a post down.
 *
 * The two that matter operationally pull in opposite directions:
 *
 *   MOD     the subreddit rejected the post. The rules were wrong, the flair
 *           was wrong, or the sub wanted verification. The account is healthy —
 *           post somewhere else.
 *   REDDIT  the site's own filter caught it. The post was never visible to
 *           anyone. A run of these on one account is what a shadowban looks
 *           like from the outside, and it is a reason to stop posting, not to
 *           pick a different subreddit.
 *
 * Anything unrecognised stays UNKNOWN rather than being folded into the nearest
 * plausible bucket. A 404 on re-check ("not returned by api") is the common
 * case, and it genuinely could be either.
 */
const MOD = new Set(['moderator', 'automod_filtered', 'community_ops'])
const REDDIT = new Set([
  'reddit',
  'anti_evil_ops',
  'content_takedown',
  'copyright_takedown',
  'legal_operations',
])
const AUTHOR = new Set(['deleted', 'author'])

export function classifyRemoval(
  reason: string | null | undefined,
  status: 'REMOVED' | 'DELETED' | string,
): RemovedBy | null {
  if (status !== 'REMOVED' && status !== 'DELETED') return null
  const key = (reason ?? '').trim().toLowerCase()
  if (status === 'DELETED' || AUTHOR.has(key)) return 'AUTHOR'
  if (MOD.has(key)) return 'MOD'
  if (REDDIT.has(key)) return 'REDDIT'
  return 'UNKNOWN'
}

export const REMOVED_BY_LABEL: Record<RemovedBy, string> = {
  MOD: 'Removed by mods',
  REDDIT: 'Caught by Reddit filter',
  AUTHOR: 'Deleted by us',
  UNKNOWN: 'Gone, cause unknown',
}
