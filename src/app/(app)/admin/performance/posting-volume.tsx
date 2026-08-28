'use client'

import * as React from 'react'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'

export type Window = '24h' | '7d' | '30d'

export interface VolumeCell {
  posted: number
  live: number
  byMod: number
  byReddit: number
  byAuthor: number
  unknown: number
}

export interface AccountVolume {
  accountId: string
  username: string
  status: string
  lifetime: number
  windows: Record<Window, VolumeCell>
}

const WINDOWS: Window[] = ['24h', '7d', '30d']
const LABEL: Record<Window, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
}

/**
 * What went out and what survived, per posting account and in total.
 *
 * The removal columns are split because mod removals and Reddit-filter
 * removals are different diagnoses wearing the same number. A column of mod
 * removals says the subreddit choice is wrong. A column of Reddit removals says
 * the account is being filtered site-wide and should stop posting entirely.
 */
export function PostingVolume({
  total,
  accounts,
  activeInWindow,
  accountsTotal,
}: {
  total: Record<Window, VolumeCell>
  accounts: AccountVolume[]
  activeInWindow: number
  accountsTotal: number
}) {
  const [win, setWin] = React.useState<Window>('7d')
  const [showIdle, setShowIdle] = React.useState(false)

  const rows = accounts.filter((a) => showIdle || a.windows[win].posted > 0)
  const t = total[win]

  return (
    <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-3">
        <div>
          <span className="text-18 text-fg font-semibold">Posting volume</span>
          <p className="sublabel mt-0.5">
            Counted by when the post went out, so a removal always counts against the day the work
            was done. {activeInWindow} of {accountsTotal} accounts posted in the last 30 days.
          </p>
        </div>
      </div>

      {/* all three timeframes visible at once — the toggle only decides which
          one the removal columns below describe */}
      <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:grid-cols-3">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWin(w)}
            className={cn(
              'rounded-[10px] border px-4 py-3 text-left transition-colors',
              win === w ? 'border-accent bg-accent-soft' : 'border-hairline hover:border-fg-muted',
            )}
          >
            <div className="label-xs">{LABEL[w]}</div>
            <div className="kpi mt-0.5">{fmtNum(total[w].posted)}</div>
            <div className="text-13 text-fg-muted mt-1 flex flex-wrap gap-x-2.5">
              <span className="text-positive">{fmtNum(total[w].live)} live</span>
              {total[w].byMod > 0 && <span className="text-warning">{total[w].byMod} mods</span>}
              {total[w].byReddit > 0 && (
                <span className="text-negative">{total[w].byReddit} filter</span>
              )}
              {total[w].unknown > 0 && <span>{total[w].unknown} unknown</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="border-hairline flex flex-wrap items-center gap-3 border-y px-4 py-2.5">
        <span className="text-13 text-fg-secondary">
          Removals below are for <strong className="text-fg">{LABEL[win].toLowerCase()}</strong>
        </span>
        <button
          type="button"
          onClick={() => setShowIdle((v) => !v)}
          className={cn(
            'text-13 rounded-md border px-2.5 py-1 transition-colors',
            showIdle
              ? 'border-accent text-accent bg-accent-soft'
              : 'border-hairline text-fg-muted hover:text-fg',
          )}
        >
          {showIdle ? 'Hide' : 'Show'} accounts that posted nothing
        </button>
        <span className="text-fg-muted ml-auto text-13">{rows.length} accounts</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-2">
            <tr>
              {[
                'Account',
                'Status',
                '24h',
                '7d',
                '30d',
                'Live',
                'By mods',
                'Reddit filter',
                'Unknown',
                'Lifetime',
              ].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap',
                    i > 1 && 'text-right',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const c = a.windows[win]
              return (
                <tr key={a.accountId} className="border-hairline hover:bg-surface-2 border-b">
                  <td className="mono text-14 text-fg px-3 py-2 whitespace-nowrap">
                    u/{a.username}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={a.status} />
                  </td>
                  {WINDOWS.map((w) => (
                    <td
                      key={w}
                      className={cn(
                        'mono tnum px-3 py-2 text-right text-14',
                        w === win ? 'text-fg font-medium' : 'text-fg-muted',
                      )}
                    >
                      {a.windows[w].posted || '—'}
                    </td>
                  ))}
                  <Num v={c.live} tone="positive" />
                  <Num v={c.byMod} tone="warning" />
                  <Num v={c.byReddit} tone="negative" />
                  <Num v={c.unknown} tone="muted" />
                  <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                    {a.lifetime}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-14 text-fg-muted px-4 py-10 text-center">
                  Nothing posted in {LABEL[win].toLowerCase()}.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2/60">
              <td className="text-14 text-fg px-3 py-2 font-medium" colSpan={2}>
                All accounts
              </td>
              {WINDOWS.map((w) => (
                <td
                  key={w}
                  className={cn(
                    'mono tnum px-3 py-2 text-right text-14 font-medium',
                    w === win ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  {fmtNum(total[w].posted)}
                </td>
              ))}
              <Num v={t.live} tone="positive" bold />
              <Num v={t.byMod} tone="warning" bold />
              <Num v={t.byReddit} tone="negative" bold />
              <Num v={t.unknown} tone="muted" bold />
              <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14 font-medium">
                {fmtNum(accounts.reduce((s, a) => s + a.lifetime, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/** A zero is written as a dash: nothing removed should not draw the eye. */
function Num({
  v,
  tone,
  bold,
}: {
  v: number
  tone: 'positive' | 'warning' | 'negative' | 'muted'
  bold?: boolean
}) {
  return (
    <td
      className={cn(
        'mono tnum px-3 py-2 text-right text-14',
        v === 0
          ? 'text-fg-muted'
          : tone === 'positive'
            ? 'text-positive'
            : tone === 'warning'
              ? 'text-warning'
              : tone === 'negative'
                ? 'text-negative'
                : 'text-fg-secondary',
        bold && 'font-medium',
      )}
    >
      {v || '—'}
    </td>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'text-positive border-positive/40 bg-positive/10'
      : status === 'SUSPENDED' || status === 'SHADOWBANNED'
        ? 'text-negative border-negative/40 bg-negative/10'
        : 'text-fg-muted border-hairline'
  return (
    <span className={cn('text-13 mono rounded-[4px] border px-1.5 py-0.5', tone)}>
      {status.toLowerCase()}
    </span>
  )
}
