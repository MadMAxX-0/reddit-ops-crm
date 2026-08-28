/**
 * Client-safe presentation types and labels for accounts.
 *
 * Deliberately separate from lib/queries/* : anything a client component
 * imports for real (not just as a type) drags its whole module graph into the
 * browser bundle, and the query modules import Prisma.
 */

export interface AccountRowDTO {
  id: string
  username: string
  status: string
  healthScore: number
  ageDays: number
  karmaPost: number
  karmaComment: number
  verifiedCount: number
  verifiedSubreddits: string[]
  creatorName: string | null
  posterName: string | null
  createdByName: string | null
  proxyLabel: string | null
  lastCheckedAt: Date | null
  shadowbanned: boolean
  suspendedAt: Date | null
  pollTier: string
  suspectedMissedPosts: number
  posts30d: number
  /// every post ever recorded for this account, not just the window
  postsTotal: number
  removed30d: number
  removalRate: number | null
}

export type Tone = 'positive' | 'negative' | 'warning' | 'info' | 'muted' | 'accent'

export const ACCOUNT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'positive',
  READY: 'info',
  WARMING: 'warning',
  SHADOWBANNED: 'negative',
  SUSPENDED: 'negative',
  RETIRED: 'muted',
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  READY: 'Ready',
  WARMING: 'Warming',
  SHADOWBANNED: 'Shadowbanned',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
}

export const POST_STATUS_TONE: Record<string, Tone> = {
  LIVE: 'positive',
  REMOVED: 'negative',
  DELETED: 'muted',
  SHADOWBANNED: 'warning',
}

export const POST_STATUS_LABEL: Record<string, string> = {
  LIVE: 'Live',
  REMOVED: 'Removed',
  DELETED: 'Deleted',
  SHADOWBANNED: 'Shadowbanned',
}

export const CREATION_OUTCOME_LABEL: Record<string, string> = {
  SUCCESS: 'Success',
  FAILED_CREATE: 'Failed on creation',
  FAILED_VERIFY: 'Failed verification',
  FAILED_CAPTCHA: 'Failed captcha',
}
