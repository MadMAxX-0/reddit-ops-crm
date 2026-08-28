'use client'

import Link from 'next/link'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

export interface AccountRow {
  accountId: string
  username: string
  modelLabel: string
  posts: number
  removed: number
  removalRate: number | null
  avgUpvotes: number | null
  clicks: number | null
  lifetimeClicks: number | null
  subs: number | null
  revenueCents: number | null
  linkCount: number
}

export interface Group {
  posterId: string
  posterName: string
  accounts: AccountRow[]
  posts: number
  removed: number
  clicks: number
  subs: number
  revenueCents: number
  avgUpvotes: number | null
  untracked: number
}

const COLS = ['Posts', 'Removed', 'Avg upvotes', 'Clicks', 'Subs', 'Revenue']

/** One compact figure in a group header — label under value, small enough to sit
 *  beside the poster's name without competing with the table below. */
function HeadStat({
  label,
  value,
  warn,
  title,
}: {
  label: string
  value: string
  warn?: boolean
  title?: string
}) {
  return (
    <div className="text-right" title={title}>
      <div
        className={cn('mono text-15 leading-none font-medium', warn ? 'text-warning' : 'text-fg')}
      >
        {value}
      </div>
      <div className="text-fg-muted text-13 mt-1 leading-none">{label}</div>
    </div>
  )
}

/**
 * The accounts in rotation, grouped by the poster who works them.
 *
 * One row per account rather than one per VA: an account that has gone quiet is
 * the thing you need to see, and a VA total hides it behind the accounts that
 * are still producing.
 */
export function AccountPerformance({
  groups,
  rangeLabel,
}: {
  groups: Group[]
  rangeLabel: string
}) {
  if (groups.length === 0) {
    return (
      <div className="bg-surface border-hairline rounded-[10px] border">
        <EmptyState
          title="No accounts assigned to a poster."
          hint="Move an account to Active in the pipeline to start tracking it."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div
          key={g.posterId}
          className="bg-surface border-hairline overflow-hidden rounded-[10px] border"
        >
          <div className="border-hairline flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-18 text-fg font-semibold">{g.posterName}</h2>
              <span className="text-fg-muted text-13">
                {g.accounts.length} accounts · {g.accounts.filter((a) => a.posts > 0).length}{' '}
                posting · {rangeLabel.toLowerCase()}
              </span>
            </div>
            <div className="flex items-end gap-5">
              <HeadStat label="Posts" value={fmtNum(g.posts)} />
              <HeadStat label="Clicks" value={fmtNum(g.clicks)} />
              <HeadStat
                label="Tracked"
                value={`${g.accounts.length - g.untracked}/${g.accounts.length}`}
                warn={g.untracked > 0}
                title={
                  g.untracked > 0
                    ? `${g.untracked} of these accounts have no tracking link of their own, so their clicks, subs and revenue cannot be separated from the shared Reddit links`
                    : 'every account here has its own tracking link'
                }
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  <th className="text-fg-secondary border-hairline h-9 border-b px-4 text-13 font-medium whitespace-nowrap">
                    Account
                  </th>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className="text-fg-secondary border-hairline h-9 border-b px-4 text-right text-13 font-medium whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.accounts.map((a) => {
                  const quiet = a.posts === 0
                  return (
                    <tr
                      key={a.accountId}
                      className={cn(
                        'border-hairline hover:bg-surface-2 border-b',
                        quiet && 'opacity-60',
                      )}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Link
                          href={`/accounts?account=${a.accountId}`}
                          className="hover:text-accent inline-flex items-baseline gap-2"
                        >
                          <span className="mono text-14 text-fg">u/{a.username}</span>
                          <span className="text-fg-muted text-13">{a.modelLabel}</span>
                        </Link>
                      </td>
                      <td className="mono text-14 px-4 py-2.5 text-right">{fmtNum(a.posts)}</td>
                      <td
                        className={cn(
                          'mono text-14 px-4 py-2.5 text-right',
                          (a.removalRate ?? 0) > 0.15 && 'text-negative',
                        )}
                      >
                        {a.removed}
                        {a.posts > 0 && (
                          <span className="text-fg-muted"> · {fmtPct(a.removalRate, 0)}</span>
                        )}
                      </td>
                      <td className="mono text-14 px-4 py-2.5 text-right">
                        {a.avgUpvotes == null ? '—' : fmtNum(a.avgUpvotes)}
                      </td>
                      <td className="mono text-14 px-4 py-2.5 text-right">
                        {a.clicks != null ? (
                          fmtNum(a.clicks)
                        ) : a.lifetimeClicks ? (
                          // no window figure yet, so the running total stands in,
                          // marked so it is never mistaken for this period's
                          <span
                            className="text-fg-muted"
                            title="Total clicks on this account's link since it was created — clicks are not reported by date, so a figure for this window needs a second counter reading"
                          >
                            {fmtNum(a.lifetimeClicks)} <span className="text-13">all time</span>
                          </span>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </td>
                      <td className="mono text-14 px-4 py-2.5 text-right">
                        {a.subs == null ? <span className="text-fg-muted">—</span> : fmtNum(a.subs)}
                      </td>
                      <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                        {a.revenueCents == null ? (
                          <span
                            className="text-fg-muted"
                            title="no OnlyFans tracking link of its own"
                          >
                            no link
                          </span>
                        ) : (
                          fmtMoney(a.revenueCents)
                        )}
                      </td>
                    </tr>
                  )
                })}

                <tr className="bg-surface-2">
                  <td className="text-14 text-fg px-4 py-2.5 font-medium whitespace-nowrap">
                    {g.posterName} total
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtNum(g.posts)}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtNum(g.removed)}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {g.avgUpvotes == null ? '—' : fmtNum(g.avgUpvotes)}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtNum(g.clicks)}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtNum(g.subs)}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtMoney(g.revenueCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
