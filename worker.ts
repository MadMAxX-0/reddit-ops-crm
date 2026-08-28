/**
 * Scraper worker process.  `npm run worker`
 *
 * Deliberately a separate process from the web app: a slow or rate-limited
 * scrape must never make a page hang, and the worker needs to survive a deploy
 * that restarts the web tier.
 */
import 'dotenv/config'
import { Worker, UnrecoverableError } from 'bullmq'
import type { ScraperJobType } from './src/generated/prisma/client'
import { prisma } from './src/lib/prisma'
import { JOB_RUNNERS } from './src/lib/jobs/registry'
import { ensureJobConfigs, getJobConfig } from './src/lib/jobs/config'
import { QUEUE_NAME, deadLetterQueue, redis, scheduleAll } from './src/lib/jobs/queue'
import { backoffMs } from './src/lib/reddit/rate-limit'
import { redditProvider } from './src/lib/reddit'
import { runScheduledReports } from './src/lib/reports/scheduler'

async function main() {
  await ensureJobConfigs()
  await scheduleAll()
  console.log(`[worker] provider=${redditProvider().name} redis=${process.env.REDIS_URL ?? 'redis://localhost:6379'}`)

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // Reports are not a scraper job: they read the database rather than the
      // network, so they have their own branch and their own failure mode.
      if ((job.data?.type ?? job.name) === 'REPORTS') {
        const result = await runScheduledReports()
        if (result.errors.length) console.warn('[worker] report errors:', result.errors.join(' | '))
        return result
      }

      const type = (job.data?.type ?? job.name) as ScraperJobType
      const runner = JOB_RUNNERS[type]
      if (!runner) throw new UnrecoverableError(`unknown job type ${type}`)

      const config = await getJobConfig(type)
      if (config.paused) return { skipped: 'paused' }

      const { type: _t, ...payload } = job.data ?? {}
      void _t
      return runner(payload)
    },
    {
      connection: redis(),
      // one at a time: the polling budget is global, and parallel workers just
      // race each other into the rate limiter
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
      settings: { backoffStrategy: (attemptsMade: number) => backoffMs(attemptsMade, 2000, 120_000) },
    },
  )

  worker.on('completed', (job) => {
    console.log(`[worker] ${job.name} completed`)
  })

  worker.on('failed', async (job, err) => {
    console.error(`[worker] ${job?.name} failed (${job?.attemptsMade}/${job?.opts.attempts}):`, err.message)
    if (!job) return
    const exhausted = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1)
    if (!exhausted) return

    // Out of retries: park it in the dead-letter queue and mark the run so the
    // admin page shows a red row rather than silently losing the failure.
    await deadLetterQueue().add(job.name, { ...job.data, error: err.message, failedAt: Date.now() })
    const type = (job.data?.type ?? job.name) as ScraperJobType
    const latest = await prisma.scraperJob.findFirst({
      where: { type },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    })
    if (latest) {
      await prisma.scraperJob.update({
        where: { id: latest.id },
        data: { status: 'DEAD_LETTER', lastError: err.message.slice(0, 1000), finishedAt: new Date() },
      })
    }
  })

  const shutdown = async () => {
    console.log('[worker] shutting down')
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[worker] fatal', err)
  process.exit(1)
})
