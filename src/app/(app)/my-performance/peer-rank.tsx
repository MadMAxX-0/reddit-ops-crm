'use client'

import { Card } from '@/components/ui/card'
import { fmtPct } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Rank among peers on the metrics this role is judged on.
 *
 * Position only. Other VAs' numbers, pay and personal details are deliberately
 * absent — a VA should know where they stand, not what anyone else earns.
 */
export function PeerRank({
  ranks,
  role,
}: {
  ranks: Array<{ metric: string; label: string; rank: number; of: number; value: number | null }>
  role: 'POSTER' | 'FARMER'
}) {
  return (
    <Card className="self-start">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">Rank among {role.toLowerCase()}s</h3>
        <span className="sublabel">today</span>
      </div>
      <ul className="divide-hairline divide-y">
        {ranks.map((r) => {
          const top = r.of > 0 && r.rank > 0 && r.rank <= Math.max(1, Math.ceil(r.of / 3))
          return (
            <li key={r.metric} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-14 text-fg truncate">{r.label}</div>
                <div className="sublabel">
                  {r.value == null
                    ? '—'
                    : r.metric === 'goal' || r.metric === 'successRate' || r.metric === 'survival7d'
                      ? fmtPct(r.value, 0)
                      : String(Math.round(r.value))}
                </div>
              </div>
              <span
                className={cn(
                  'mono text-18 shrink-0 font-semibold tabular-nums',
                  top ? 'text-accent' : 'text-fg',
                )}
              >
                {r.rank || '—'}
                <span className="text-fg-muted text-13 font-normal">/{r.of}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-fg-muted text-13 border-hairline border-t px-4 py-2.5 leading-relaxed">
        Rank only. Nobody else&rsquo;s numbers, pay or personal details appear on this screen.
      </p>
    </Card>
  )
}
