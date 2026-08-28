import { prisma } from '@/lib/prisma'
import type { ScraperJobType } from '@/generated/prisma/client'

/**
 * Intervals are config values, not constants, because they will be tuned
 * against the real rate limit rather than guessed at once and forgotten.
 */
export const JOB_DEFAULTS: Record<
  ScraperJobType,
  {
    intervalSec: number
    rateLimitPerMin: number
    maxAttempts: number
    label: string
    description: string
  }
> = {
  POST_DISCOVERY: {
    intervalSec: 300,
    rateLimitPerMin: 55,
    maxAttempts: 4,
    label: 'Post discovery',
    description:
      'Polls each account timeline and inserts posts we have not seen. Nothing downstream exists without this.',
  },
  POST_METRICS: {
    intervalSec: 300,
    rateLimitPerMin: 90,
    maxAttempts: 3,
    label: 'Post metrics',
    description: 'Appends an upvote/comment snapshot on a decaying cadence for the first 7 days.',
  },
  REMOVAL_DETECTION: {
    intervalSec: 900,
    rateLimitPerMin: 60,
    maxAttempts: 3,
    label: 'Removal detection',
    description:
      'Re-checks posts outside the metrics window and confirms removals we already recorded.',
  },
  ACCOUNT_HEALTH: {
    intervalSec: 86_400,
    rateLimitPerMin: 30,
    maxAttempts: 2,
    label: 'Account health',
    description:
      'Daily karma, age and suspension check. Also raises the suspected-missed-post signal.',
  },
  SUBREDDIT_RULES: {
    intervalSec: 604_800,
    rateLimitPerMin: 20,
    maxAttempts: 2,
    label: 'Subreddit rules',
    description: 'Weekly refresh of rules, verification requirements and subscriber counts.',
  },
  OF_CONVERSION_SYNC: {
    intervalSec: 3600,
    rateLimitPerMin: 30,
    maxAttempts: 5,
    label: 'OnlyFans sync',
    description:
      'Hourly: subscriber counts, earnings per day per model, and a reading of every OnlyFans tracking link. The link readings are what make Reddit-only clicks, subs and revenue possible, so a gap here is a gap in the dashboard.',
  },
}

export const DEFAULT_TIER_INTERVALS_SEC = {
  HOT: 600, // posted in the last 24h
  WARM: 3600, // posted in the last 7d
  COLD: 21_600, // assigned to a poster, no post in 7d
  DORMANT: 86_400, // in warm-up or unassigned
} as const

export async function getJobConfig(type: ScraperJobType) {
  const row = await prisma.scraperConfig.findUnique({ where: { type } })
  const defaults = JOB_DEFAULTS[type]
  if (!row) {
    return {
      type,
      enabled: true,
      paused: false,
      intervalSec: defaults.intervalSec,
      rateLimitPerMin: defaults.rateLimitPerMin,
      maxAttempts: defaults.maxAttempts,
      hotIntervalSec: DEFAULT_TIER_INTERVALS_SEC.HOT,
      warmIntervalSec: DEFAULT_TIER_INTERVALS_SEC.WARM,
      coldIntervalSec: DEFAULT_TIER_INTERVALS_SEC.COLD,
      dormantIntervalSec: DEFAULT_TIER_INTERVALS_SEC.DORMANT,
    }
  }
  return row
}

export async function ensureJobConfigs() {
  for (const [type, d] of Object.entries(JOB_DEFAULTS) as [
    ScraperJobType,
    (typeof JOB_DEFAULTS)[ScraperJobType],
  ][]) {
    await prisma.scraperConfig.upsert({
      where: { type },
      create: {
        type,
        intervalSec: d.intervalSec,
        rateLimitPerMin: d.rateLimitPerMin,
        maxAttempts: d.maxAttempts,
        hotIntervalSec: DEFAULT_TIER_INTERVALS_SEC.HOT,
        warmIntervalSec: DEFAULT_TIER_INTERVALS_SEC.WARM,
        coldIntervalSec: DEFAULT_TIER_INTERVALS_SEC.COLD,
        dormantIntervalSec: DEFAULT_TIER_INTERVALS_SEC.DORMANT,
      },
      update: {},
    })
  }
}
