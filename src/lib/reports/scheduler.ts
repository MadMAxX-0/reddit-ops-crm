import { DateTime } from 'luxon'
import { prisma } from '@/lib/prisma'
import { getWorkspace } from '@/lib/workspace'
import { generateReport, ReportUnavailable } from './generate'
import { periodFor } from './context'
import type { ReportKind } from './schema'

/**
 * Fires the scheduled report types on their cadence, in WORKSPACE time.
 *
 * Runs hourly and asks "is this report due and not already written?" rather
 * than firing on a cron minute — a worker restart at 06:59 would otherwise skip
 * the daily brief entirely, and nobody notices a report that never arrives.
 */
export interface DueReport {
  kind: ReportKind
  scopeId: string | null
  label: string
}

export async function dueReports(now = new Date()): Promise<DueReport[]> {
  const workspace = await getWorkspace()
  const tz = workspace.dayBoundaryTimezone
  const local = DateTime.fromJSDate(now).setZone(tz)
  const due: DueReport[] = []

  // Daily ops brief — 07:00 workspace time, covering yesterday
  if (local.hour >= 7) {
    const period = periodFor('daily_ops', tz, now)
    if (!(await exists('daily_ops', null, period.start))) {
      due.push({ kind: 'daily_ops', scopeId: null, label: 'Daily ops brief' })
    }
  }

  // Weekly creator + VA reports — Monday, once the day has started
  if (local.weekday === 1 && local.hour >= 7) {
    const period = periodFor('weekly_creator', tz, now)

    const creators = await prisma.creator.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, stageName: true },
    })
    for (const c of creators) {
      if (!(await exists('weekly_creator', c.id, period.start))) {
        due.push({
          kind: 'weekly_creator',
          scopeId: c.id,
          label: `Weekly creator · ${c.stageName}`,
        })
      }
    }

    const vas = await prisma.user.findMany({
      where: { role: { in: ['POSTER', 'FARMER'] }, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
    for (const v of vas) {
      if (!(await exists('weekly_va', v.id, period.start))) {
        due.push({ kind: 'weekly_va', scopeId: v.id, label: `Weekly VA · ${v.name}` })
      }
    }
  }

  // Subreddit intelligence — first of the month
  if (local.day === 1 && local.hour >= 8) {
    const period = periodFor('subreddit_intel', tz, now)
    if (!(await exists('subreddit_intel', null, period.start))) {
      due.push({ kind: 'subreddit_intel', scopeId: null, label: 'Subreddit intelligence' })
    }
  }

  return due
}

async function exists(kind: ReportKind, scopeId: string | null, periodStart: Date) {
  const row = await prisma.report.findFirst({
    where: { kind, scopeId, periodStart },
    select: { id: true },
  })
  return Boolean(row)
}

export async function runScheduledReports(now = new Date()) {
  const due = await dueReports(now)
  let written = 0
  let skipped = 0
  const errors: string[] = []

  for (const item of due) {
    try {
      await generateReport({ kind: item.kind, scopeId: item.scopeId })
      written += 1
    } catch (err) {
      if (err instanceof ReportUnavailable) {
        // No credentials, or the model declined. Not a crash — report it and
        // move on, rather than failing the whole scheduler run.
        skipped += 1
        errors.push(`${item.label}: ${err.message}`)
        continue
      }
      errors.push(`${item.label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { due: due.length, written, skipped, errors }
}
