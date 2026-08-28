'use client'

import { Card } from '@/components/ui/card'
import { TierBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtCompact, fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import type { BreakdownRow } from '@/lib/queries/metrics'
import { cn } from '@/lib/utils'

export function BreakdownTable({
  title,
  rows,
  nameHeader,
}: {
  title: string
  rows: BreakdownRow[]
  nameHeader: string
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">{title}</h3>
        <span className="sublabel">by revenue</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing in this window." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-2">
              <tr>
                {[nameHeader, 'Posts', 'Median ↑', 'Landings', 'Subs', 'Removal', 'Revenue'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'label-xs border-hairline h-8 border-b px-3 font-normal whitespace-nowrap',
                        i > 0 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className="border-hairline hover:bg-surface-2 border-b last:border-b-0"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="mono text-13 text-fg-muted w-4 shrink-0 text-right">
                        {i + 1}
                      </span>
                      {r.meta && /^[SABC] /.test(r.meta) && <TierBadge tier={r.meta[0]} />}
                      <div className="min-w-0">
                        <div className="text-14 text-fg truncate">{r.name}</div>
                        {r.meta && <div className="text-fg-muted text-13 truncate">{r.meta}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="mono text-14 px-3 py-2 text-right">{fmtNum(r.posts)}</td>
                  <td className="mono text-14 px-3 py-2 text-right">
                    {r.medianUpvotes == null ? '—' : fmtNum(r.medianUpvotes)}
                  </td>
                  <td className="mono text-14 px-3 py-2 text-right">{fmtCompact(r.landings)}</td>
                  <td className="mono text-14 px-3 py-2 text-right">{fmtNum(r.conversions)}</td>
                  <td
                    className={cn(
                      'mono text-14 px-3 py-2 text-right',
                      r.removalRate != null && r.removalRate > 0.2 && 'text-negative',
                    )}
                  >
                    {fmtPct(r.removalRate, 0)}
                  </td>
                  <td className="mono text-14 text-accent px-3 py-2 text-right">
                    {fmtMoney(r.revenueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
