/**
 * Run a scraper job once, in-process, without the queue.
 *   npx tsx scripts/job.ts discovery [--limit 50]
 *   npx tsx scripts/job.ts metrics | removal | health | subreddits | of-sync | all
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { JOB_RUNNERS } from '../src/lib/jobs/registry'
import { ensureJobConfigs } from '../src/lib/jobs/config'
import { redditProvider } from '../src/lib/reddit'
import type { ScraperJobType } from '../src/generated/prisma/client'

const ALIASES: Record<string, ScraperJobType> = {
  discovery: 'POST_DISCOVERY',
  metrics: 'POST_METRICS',
  removal: 'REMOVAL_DETECTION',
  health: 'ACCOUNT_HEALTH',
  subreddits: 'SUBREDDIT_RULES',
  'of-sync': 'OF_CONVERSION_SYNC',
}

async function main() {
  const [name, ...rest] = process.argv.slice(2)
  await ensureJobConfigs()

  const limitFlag = rest.indexOf('--limit')
  const payload = limitFlag >= 0 ? { limit: Number(rest[limitFlag + 1]) } : {}

  const types: ScraperJobType[] =
    name === 'all'
      ? (Object.values(ALIASES) as ScraperJobType[])
      : [ALIASES[name] ?? (name?.toUpperCase() as ScraperJobType)]

  if (!types[0] || !JOB_RUNNERS[types[0]]) {
    console.error(`unknown job "${name}". one of: ${Object.keys(ALIASES).join(', ')}, all`)
    process.exit(1)
  }

  console.log(`provider = ${redditProvider().name}`)
  for (const type of types) {
    const result = await JOB_RUNNERS[type](payload)
    console.log(type, JSON.stringify(result))
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
