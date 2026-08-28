'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { fmtMoney, fmtNum } from '@/lib/format'
import { setLinkTracked } from './link-actions'
import { cn } from '@/lib/utils'

/**
 * The Reddit tracking links, and which of them the CRM counts.
 *
 * The tick is the whole point of this screen: it decides what "Reddit revenue"
 * on the dashboard includes. The classifier's guess seeds it, the team owns it.
 *
 * Earnings are per link and count every fan who claimed it, which is how the
 * OnlyFans panel reports them — so a fan who claimed two links shows under
 * both, and these rows will not add up to the dashboard total.
 */

export interface LinkRow {
  id: string
  code: number
  name: string
  model: string | null
  url: string | null
  trackedInCrm: boolean
  classifiedReddit: boolean
  redditAccount: string | null
  clicks: number
  subs: number
  claimersCached: number
  spenders: number
  revenueCents: number
}

export function LinksTable({
  rows,
  rangeLabel,
  canEdit,
}: {
  rows: LinkRow[]
  rangeLabel: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle(row: LinkRow) {
    if (!canEdit) return
    setBusy(row.id)
    setError(null)
    const res = await setLinkTracked([row.id], !row.trackedInCrm)
    if (!res.ok) setError(res.error)
    setBusy(null)
    router.refresh()
  }

  const tracked = rows.filter((r) => r.trackedInCrm)
  const trackedRevenue = tracked.reduce((s, r) => s + r.revenueCents, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-fg-secondary text-14">
          {fmtNum(tracked.length)} of {fmtNum(rows.length)} links counted ·{' '}
          {fmtMoney(trackedRevenue)} across them · {rangeLabel.toLowerCase()}
        </span>
      </div>

      {error && <p className="text-negative text-14">{error}</p>}

      <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-2">
              <tr>
                {[
                  'Counted',
                  'Link',
                  'Model',
                  'Clicks',
                  'Fans',
                  'Fan list',
                  'Spenders',
                  'Earnings',
                ].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      'text-fg-secondary border-hairline h-9 border-b px-4 text-13 font-medium whitespace-nowrap',
                      i > 2 && 'text-right',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-hairline hover:bg-surface-2 border-b',
                    !r.trackedInCrm && 'opacity-55',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(r)}
                      disabled={!canEdit || busy === r.id}
                      title={canEdit ? 'Count this link in the CRM' : 'Managers only'}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors',
                        r.trackedInCrm
                          ? 'border-accent bg-accent text-white'
                          : 'border-fg-muted/60 hover:border-fg-secondary',
                        !canEdit && 'cursor-not-allowed',
                      )}
                    >
                      {busy === r.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : r.trackedInCrm ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="mono text-14 text-fg">c{r.code}</span>
                      <span className="text-14 text-fg">{r.name || '—'}</span>
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg-muted hover:text-accent"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {r.redditAccount && (
                      <div className="text-fg-muted text-13">u/{r.redditAccount}</div>
                    )}
                  </td>
                  <td className="text-fg-secondary text-14 px-4 py-2.5 whitespace-nowrap">
                    {r.model ?? '—'}
                  </td>
                  <td className="mono text-14 px-4 py-2.5 text-right">{fmtNum(r.clicks)}</td>
                  <td className="mono text-14 px-4 py-2.5 text-right">{fmtNum(r.subs)}</td>
                  <td
                    className={cn(
                      'mono text-14 px-4 py-2.5 text-right',
                      r.subs > 0 && r.claimersCached < r.subs * 0.9 && 'text-warning',
                    )}
                    title={
                      r.subs > 0 && r.claimersCached < r.subs * 0.9
                        ? 'Fan list incomplete — earnings for this link are undercounted'
                        : undefined
                    }
                  >
                    {fmtNum(r.claimersCached)}
                  </td>
                  <td className="mono text-14 px-4 py-2.5 text-right">{fmtNum(r.spenders)}</td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right font-medium">
                    {fmtMoney(r.revenueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
