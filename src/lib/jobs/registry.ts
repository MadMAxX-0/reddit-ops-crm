import type { ScraperJobType } from '@/generated/prisma/client'
import { runPostDiscovery } from './discovery'
import { runPostMetrics } from './metrics'
import { runRemovalDetection } from './removal'
import { runAccountHealth } from './health'
import { runSubredditRules } from './subreddit-rules'
import { runOfSync } from './of-sync-v2'

export type JobRunner = (payload?: Record<string, unknown>) => Promise<{
  itemsProcessed: number
  errorsCount: number
  lastError?: string | null
  detail?: Record<string, number | string>
}>

export const JOB_RUNNERS: Record<ScraperJobType, JobRunner> = {
  POST_DISCOVERY: (p) => runPostDiscovery(p as never),
  POST_METRICS: (p) => runPostMetrics(p as never),
  REMOVAL_DETECTION: (p) => runRemovalDetection(p as never),
  ACCOUNT_HEALTH: (p) => runAccountHealth(p as never),
  SUBREDDIT_RULES: (p) => runSubredditRules(p as never),
  OF_CONVERSION_SYNC: (p) => runOfSync(p as never),
}

export const JOB_TYPES = Object.keys(JOB_RUNNERS) as ScraperJobType[]
