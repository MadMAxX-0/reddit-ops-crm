import { Queue, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import { prisma } from '@/lib/prisma'
import type { ScraperJobType } from '@/generated/prisma/client'
import { JOB_TYPES } from './registry'
import { getJobConfig } from './config'

export const QUEUE_NAME = 'scraper'
export const DLQ_NAME = 'scraper-dlq'

let connection: IORedis | null = null

export function redis(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // required by BullMQ workers
    })
  }
  return connection
}

let queue: Queue | null = null
let dlq: Queue | null = null

export function scraperQueue(): Queue {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redis() })
  return queue
}

export function deadLetterQueue(): Queue {
  if (!dlq) dlq = new Queue(DLQ_NAME, { connection: redis() })
  return dlq
}

export function defaultJobOptions(maxAttempts: number): JobsOptions {
  return {
    attempts: maxAttempts,
    // jittered exponential backoff: a rate-limited fleet that retries in
    // lockstep just rate-limits itself again
    backoff: { type: 'custom' },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  }
}

/** Repeatable schedules, driven by ScraperConfig rather than constants. */
export async function scheduleAll() {
  const q = scraperQueue()

  // clear old schedulers so an interval change actually takes effect
  for (const scheduler of await q.getJobSchedulers()) {
    await q.removeJobScheduler(scheduler.key)
  }

  // hourly report scheduler — it decides for itself what is actually due
  await q.upsertJobScheduler(
    'sched:REPORTS',
    { every: 3_600_000 },
    {
      name: 'REPORTS',
      data: { type: 'REPORTS' },
      opts: { attempts: 1, removeOnComplete: { count: 50 } },
    },
  )

  for (const type of JOB_TYPES) {
    const config = await getJobConfig(type)
    if (!config.enabled || config.paused) continue
    await q.upsertJobScheduler(
      `sched:${type}`,
      { every: config.intervalSec * 1000 },
      { name: type, data: { type }, opts: defaultJobOptions(config.maxAttempts) },
    )
  }
  return q
}

/** Manual "run now" from the Scraper admin page. */
export async function enqueueNow(type: ScraperJobType, payload: Record<string, unknown> = {}) {
  const config = await getJobConfig(type)
  return scraperQueue().add(type, { type, ...payload }, defaultJobOptions(config.maxAttempts))
}

export async function pauseJob(type: ScraperJobType, paused: boolean) {
  await prisma.scraperConfig.update({ where: { type }, data: { paused } })
  await scheduleAll()
}
