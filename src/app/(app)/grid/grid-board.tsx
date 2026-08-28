'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import { fmtCompact } from '@/lib/format'
import { fmtRelative } from '@/lib/time'
import type { GridCell, GridRow, GridSection } from '@/lib/queries/grid'
import { cn } from '@/lib/utils'

/**
 * Poster → account × day. One section per poster, one row per account, one
 * column per day.
 *
 * Colour carries a single meaning: orange is a day this account posted.
 * Everything else is a shade of "didn't". Nothing on this screen can be set by
 * hand — every mark is a post the scraper found.
 */

const WINDOWS = [7, 14, 30]

export function GridBoard({
  days,
  sections,
  unassigned,
  windowDays,
  displayTz,
}: {
  days: string[]
  sections: GridSection[]
  unassigned: GridRow[]
  windowDays: number
  displayTz: string
}) {
  const { set } = useFilterNav()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <div className="bg-surface-2 border-hairline flex items-center gap-0.5 rounded-[6px] border p-0.5">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => set({ days: String(d) })}
              className={cn(
                'text-13 h-6 rounded-[4px] px-2.5 transition-colors',
                windowDays === d
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-fg-secondary hover:text-fg',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {sections.length === 0 && unassigned.length === 0 && (
        <Card>
          <EmptyState
            title="No accounts in rotation."
            hint="Assign accounts to a poster from the Account database."
          />
        </Card>
      )}

      {sections.map((section) => (
        <Section key={section.posterId} section={section} days={days} displayTz={displayTz} />
      ))}

      {unassigned.length > 0 && (
        <Section
          section={{
            posterId: 'unassigned',
            posterName: 'Unassigned',
            rows: unassigned,
            posts: unassigned.reduce((s, r) => s + r.posts, 0),
            removed: unassigned.reduce((s, r) => s + r.removed, 0),
            activeAccounts: unassigned.filter((r) => r.posts > 0).length,
          }}
          days={days}
          displayTz={displayTz}
          muted
        />
      )}
    </div>
  )
}

function Section({
  section,
  days,
  displayTz,
  muted,
}: {
  section: GridSection
  days: string[]
  displayTz: string
  muted?: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-hairline flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 className={cn('text-18 font-semibold', muted ? 'text-fg-muted' : 'text-fg')}>
          {section.posterName}
        </h2>
        <span className="sublabel">
          {section.rows.length} account{section.rows.length === 1 ? '' : 's'} ·{' '}
          {section.activeAccounts} posting · {section.posts} post
          {section.posts === 1 ? '' : 's'}
          {section.removed > 0 && ` · ${section.removed} removed`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-auto border-collapse text-left">
          <thead className="bg-surface-2">
            <tr>
              <th className="label-xs bg-surface-2 border-hairline sticky left-0 z-20 h-8 w-[260px] min-w-[260px] border-b border-r px-3 font-normal whitespace-nowrap">
                Account
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className="label-xs border-hairline h-8 w-[30px] min-w-[30px] border-b px-0 text-center font-normal"
                  title={d}
                >
                  {d.slice(8)}
                </th>
              ))}
              <th className="label-xs border-hairline h-8 border-b px-3 text-right font-normal whitespace-nowrap">
                Posts
              </th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr
                key={row.accountId}
                className="border-hairline group hover:bg-surface-2 border-b last:border-b-0"
              >
                <td className="bg-surface group-hover:bg-surface-2 border-hairline sticky left-0 z-10 w-[260px] min-w-[260px] border-r px-3 py-1.5">
                  <Link
                    href={`/accounts?account=${row.accountId}`}
                    className="flex items-baseline gap-2 whitespace-nowrap"
                    title={`${row.karmaPost.toLocaleString()} post karma · ${row.ageDays ?? '?'}d old · last post ${row.lastPostAt ? fmtRelative(row.lastPostAt) + ' ago' : 'never'}`}
                  >
                    <span className="mono text-14 text-fg group-hover:text-accent">
                      u/{row.username}
                    </span>
                    <span className="text-13 text-fg-muted">{row.modelLabel}</span>
                  </Link>
                </td>

                {row.cells.map((cell) => (
                  <Cell key={cell.day} cell={cell} username={row.username} displayTz={displayTz} />
                ))}

                <td className="mono text-14 px-3 py-1.5 text-right whitespace-nowrap">
                  <span className={row.posts > 0 ? 'text-accent' : 'text-fg-muted'}>
                    {row.posts}
                  </span>
                  {row.removed > 0 && (
                    <span className="text-negative text-13"> · {row.removed} rm</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Cell({
  cell,
  username,
  displayTz,
}: {
  cell: GridCell
  username: string
  displayTz: string
}) {
  void displayTz
  const title =
    cell.state === 'posted'
      ? `${cell.day} · u/${username} · ${cell.posts} post${cell.posts === 1 ? '' : 's'}${cell.removed ? `, ${cell.removed} removed` : ''}`
      : cell.state === 'none'
        ? `${cell.day} · u/${username} · nothing discovered`
        : cell.state === 'inactive'
          ? `${cell.day} · u/${username} · not in rotation`
          : `${cell.day} · not yet`

  return (
    <td className="border-hairline border-b p-0 text-center align-middle" title={title}>
      <span className="flex h-7 w-[30px] items-center justify-center">
        {cell.state === 'posted' ? (
          <span
            className={cn(
              'mono flex h-5 w-6 items-center justify-center rounded-[3px] text-[12px] font-semibold',
              cell.removed > 0 ? 'bg-negative/25 text-negative' : 'bg-accent text-white',
            )}
          >
            {cell.posts > 1 ? cell.posts : '✓'}
          </span>
        ) : cell.state === 'none' ? (
          <span className="bg-fg-muted/45 h-1 w-1 rounded-full" />
        ) : cell.state === 'inactive' ? (
          <span className="bg-fg-muted/15 h-1 w-1 rounded-full" />
        ) : (
          <span className="text-fg-muted/25 text-[11px]">·</span>
        )}
      </span>
    </td>
  )
}

function Legend() {
  return (
    <div className="text-fg-muted text-13 flex flex-wrap items-center gap-4">
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-accent mono flex h-4 w-5 items-center justify-center rounded-[3px] text-[11px] font-semibold text-white">
          ✓
        </span>
        posted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-negative/25 text-negative mono flex h-4 w-5 items-center justify-center rounded-[3px] text-[11px] font-semibold">
          ✓
        </span>
        posted, removed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-fg-muted/45 h-1 w-1 rounded-full" />
        no post
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-fg-muted/15 h-1 w-1 rounded-full" />
        not in rotation
      </span>
    </div>
  )
}
