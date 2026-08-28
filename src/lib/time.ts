import { DateTime, Interval } from 'luxon'

/**
 * Two timezones exist in this product and they are never the same setting:
 *
 *   boundaryTz  — Workspace.dayBoundaryTimezone. Decides what "a day" means for
 *                 every daily aggregate (goals, ranking, creation counters).
 *   displayTz   — User.timezone. Decides how an instant is RENDERED for a viewer.
 *
 * Every screen carrying a daily figure prints both in its header. Conflating
 * them is the single most common source of "the numbers are wrong".
 */

export type DayKey = string // 'YYYY-MM-DD'

export function dayKey(instant: Date, boundaryTz: string): DayKey {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(boundaryTz).toFormat('yyyy-MM-dd')
}

export function todayKey(boundaryTz: string): DayKey {
  return DateTime.now().setZone(boundaryTz).toFormat('yyyy-MM-dd')
}

/** UTC [start, end) instants covering one workspace-day. */
export function dayBounds(key: DayKey, boundaryTz: string): { start: Date; end: Date } {
  const start = DateTime.fromFormat(key, 'yyyy-MM-dd', { zone: boundaryTz }).startOf('day')
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() }
}

/** A `@db.Date` column value for a workspace-day (midnight UTC of the key). */
export function dayDateColumn(key: DayKey): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export type RangePreset = '24h' | 'today' | '7d' | '30d' | 'mtd' | 'custom'

export interface ResolvedRange {
  start: Date
  end: Date
  /** the immediately preceding window of equal length, for period-over-period */
  prevStart: Date
  prevEnd: Date
  preset: RangePreset
  label: string
}

/**
 * Resolves a range filter into UTC instants, aligned to workspace-day
 * boundaries so "7d" means seven whole operational days, not 168 hours.
 */
export function resolveRange(
  preset: RangePreset,
  boundaryTz: string,
  custom?: { from?: string; to?: string },
): ResolvedRange {
  const today = DateTime.now().setZone(boundaryTz).startOf('day')
  let startDt = today
  let endDt = today.plus({ days: 1 })
  let label = 'Today'

  switch (preset) {
    case '24h': {
      // A rolling 24 hours, not a calendar day — "what happened since this time
      // yesterday" is the question, and it does not respect midnight.
      const now = DateTime.now().setZone(boundaryTz)
      startDt = now.minus({ hours: 24 })
      endDt = now
      label = 'Last 24 hours'
      break
    }
    case 'today':
      break
    case '7d':
      startDt = today.minus({ days: 6 })
      label = 'Last 7 days'
      break
    case '30d':
      startDt = today.minus({ days: 29 })
      label = 'Last 30 days'
      break
    case 'mtd':
      startDt = today.startOf('month')
      label = 'Month to date'
      break
    case 'custom': {
      const from = custom?.from
        ? DateTime.fromFormat(custom.from, 'yyyy-MM-dd', { zone: boundaryTz }).startOf('day')
        : today
      const to = custom?.to
        ? DateTime.fromFormat(custom.to, 'yyyy-MM-dd', { zone: boundaryTz }).startOf('day')
        : today
      startDt = from
      endDt = to.plus({ days: 1 })
      label = `${from.toFormat('LLL d')} – ${to.toFormat('LLL d')}`
      break
    }
  }

  const lengthMs = endDt.toMillis() - startDt.toMillis()
  return {
    start: startDt.toUTC().toJSDate(),
    end: endDt.toUTC().toJSDate(),
    prevStart: startDt.minus({ milliseconds: lengthMs }).toUTC().toJSDate(),
    prevEnd: startDt.toUTC().toJSDate(),
    preset,
    label,
  }
}

/** Every day key inside a resolved range, ascending. Used for chart scaffolds. */
export function dayKeysInRange(range: { start: Date; end: Date }, boundaryTz: string): DayKey[] {
  const start = DateTime.fromJSDate(range.start).setZone(boundaryTz).startOf('day')
  const end = DateTime.fromJSDate(range.end).setZone(boundaryTz).startOf('day')
  const out: DayKey[] = []
  for (let d = start; d < end; d = d.plus({ days: 1 })) out.push(d.toFormat('yyyy-MM-dd'))
  return out.length ? out : [start.toFormat('yyyy-MM-dd')]
}

/** Auto chart granularity: hourly for short ranges, daily then weekly for long. */
export function autoGranularity(range: { start: Date; end: Date }): 'hour' | 'day' | 'week' {
  const days = Interval.fromDateTimes(range.start, range.end).length('days')
  if (days <= 2) return 'hour'
  if (days <= 62) return 'day'
  return 'week'
}

// --- rendering -------------------------------------------------------------

export function fmtTs(instant: Date | string | null | undefined, displayTz: string): string {
  if (!instant) return '—'
  return DateTime.fromJSDate(new Date(instant)).setZone(displayTz).toFormat('yyyy-MM-dd HH:mm')
}

export function fmtTime(instant: Date | string | null | undefined, displayTz: string): string {
  if (!instant) return '—'
  return DateTime.fromJSDate(new Date(instant)).setZone(displayTz).toFormat('HH:mm')
}

export function fmtRelative(instant: Date | string | null | undefined): string {
  if (!instant) return '—'
  const d = DateTime.fromJSDate(new Date(instant))
  const mins = Math.round(Math.abs(DateTime.now().diff(d, 'minutes').minutes))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

/** The header line every daily screen carries, e.g.
 *  "2026-08-18 · Africa/Lagos day · timestamps Asia/Dubai" */
export function dayContextLine(key: DayKey, boundaryTz: string, displayTz: string): string {
  return `${key} · ${boundaryTz} day · timestamps ${displayTz}`
}

export const COMMON_TIMEZONES = [
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Manila',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
]
