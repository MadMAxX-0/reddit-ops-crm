import { resolveRange, type RangePreset, type ResolvedRange } from '@/lib/time'

/**
 * Creator, VA, subreddit and date-range behave identically on every page and
 * live entirely in the URL query string, so any view is shareable by copying
 * the address bar. This module is the only place that knows their names.
 */

export type SearchParams = Record<string, string | string[] | undefined>

export interface CommonFilters {
  creatorIds: string[]
  vaIds: string[]
  subredditIds: string[]
  range: ResolvedRange
  /** manager-only Me / Everyone toggle */
  scope: 'me' | 'everyone'
  q: string
  page: number
  pageSize: number
  sort?: string
  dir: 'asc' | 'desc'
}

function list(v: string | string[] | undefined): string[] {
  if (!v) return []
  const raw = Array.isArray(v) ? v : [v]
  return raw.flatMap((s) => s.split(',')).filter(Boolean)
}

function one(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

const PRESETS: RangePreset[] = ['24h', 'today', '7d', '30d', 'mtd', 'custom']

export function parseFilters(
  params: SearchParams,
  boundaryTz: string,
  defaults: { range?: RangePreset; pageSize?: number } = {},
): CommonFilters {
  const rawRange = one(params.range)
  const preset = (
    PRESETS.includes(rawRange as RangePreset) ? rawRange : (defaults.range ?? '7d')
  ) as RangePreset

  return {
    creatorIds: list(params.creator),
    vaIds: list(params.va),
    subredditIds: list(params.sub),
    range: resolveRange(preset, boundaryTz, { from: one(params.from), to: one(params.to) }),
    scope: one(params.scope) === 'me' ? 'me' : 'everyone',
    q: one(params.q)?.trim() ?? '',
    page: Math.max(1, Number(one(params.page) ?? 1) || 1),
    pageSize: Math.min(
      200,
      Math.max(10, Number(one(params.size) ?? defaults.pageSize ?? 50) || 50),
    ),
    sort: one(params.sort),
    dir: one(params.dir) === 'asc' ? 'asc' : 'desc',
  }
}

/** Build a query string from the current params plus a patch. Empty clears. */
export function patchQuery(
  current: URLSearchParams | SearchParams,
  patch: Record<string, string | string[] | null | undefined>,
): string {
  const sp =
    current instanceof URLSearchParams
      ? new URLSearchParams(current)
      : new URLSearchParams(
          Object.entries(current).flatMap(([k, v]) =>
            v === undefined
              ? []
              : Array.isArray(v)
                ? v.map((x) => [k, x] as [string, string])
                : [[k, v] as [string, string]],
          ),
        )

  for (const [key, value] of Object.entries(patch)) {
    sp.delete(key)
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(','))
    } else {
      sp.set(key, value)
    }
  }
  // changing any filter resets pagination — otherwise you land on page 7 of 2
  if (!('page' in patch)) sp.delete('page')
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'mtd', label: 'MTD' },
  { value: 'custom', label: 'Custom' },
]
