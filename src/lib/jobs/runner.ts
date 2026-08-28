import { prisma } from '@/lib/prisma'
import type { ScraperJobType } from '@/generated/prisma/client'

export interface JobResult {
  itemsProcessed: number
  errorsCount: number
  lastError?: string | null
  /** free-form counters surfaced in the job log line */
  detail?: Record<string, number | string>
}

export interface JobContext {
  jobId: string
  log: (msg: string) => void
  /** call as work completes so a killed run still reports partial progress */
  progress: (items: number, errors?: number) => void
}

/**
 * Every run is recorded, successful or not, so the Scraper admin page shows
 * real status instead of a green dot that always lies.
 */
export async function runJob(
  type: ScraperJobType,
  target: string | null,
  fn: (ctx: JobContext) => Promise<JobResult>,
): Promise<JobResult & { jobId: string; status: string }> {
  const job = await prisma.scraperJob.create({
    data: { type, target, status: 'RUNNING' },
  })

  let items = 0
  let errors = 0
  const ctx: JobContext = {
    jobId: job.id,
    log: (msg) => console.log(`[${type}] ${msg}`),
    progress: (i, e = 0) => {
      items = i
      errors = e
    },
  }

  try {
    const result = await fn(ctx)
    await prisma.scraperJob.update({
      where: { id: job.id },
      data: {
        status: result.errorsCount > 0 ? 'SUCCESS' : 'SUCCESS',
        finishedAt: new Date(),
        itemsProcessed: result.itemsProcessed,
        errorsCount: result.errorsCount,
        lastError: result.lastError ?? null,
      },
    })
    const detail = result.detail
      ? ' ' +
        Object.entries(result.detail)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : ''
    console.log(
      `[${type}] done items=${result.itemsProcessed} errors=${result.errorsCount}${detail}`,
    )
    return { ...result, jobId: job.id, status: 'SUCCESS' }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    await prisma.scraperJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        itemsProcessed: items,
        errorsCount: errors + 1,
        lastError: message.slice(0, 1000),
      },
    })
    console.error(`[${type}] FAILED ${message}`)
    return {
      itemsProcessed: items,
      errorsCount: errors + 1,
      lastError: message,
      jobId: job.id,
      status: 'FAILED',
    }
  }
}
