/** Client-safe job labels. Mirrors JOB_DEFAULTS without dragging Prisma along. */
export const JOB_LABEL: Record<string, string> = {
  POST_DISCOVERY: 'Post discovery',
  POST_METRICS: 'Post metrics',
  REMOVAL_DETECTION: 'Removal detection',
  ACCOUNT_HEALTH: 'Account health',
  SUBREDDIT_RULES: 'Subreddit rules',
  OF_CONVERSION_SYNC: 'OnlyFans sync',
}
