import { cn } from '@/lib/utils'
import { Card } from './card'

export interface Stat {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'accent' | 'positive' | 'negative' | 'warning' | 'muted'
}

const TONE: Record<NonNullable<Stat['tone']>, string> = {
  default: 'text-fg',
  accent: 'text-accent',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  muted: 'text-fg-muted',
}

/**
 * The two-line cell pattern outside a table: a dense strip of
 * label / value / qualifier used as a page or form header.
 */
export function StatRow({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <Card className={cn('divide-hairline flex flex-wrap divide-x', className)}>
      {stats.map((s) => (
        <div key={s.label} className="min-w-[9.5rem] flex-1 px-4 py-3">
          <div className="label-xs truncate">{s.label}</div>
          <div
            className={cn(
              'mono text-18 mt-1 font-semibold tabular-nums',
              TONE[s.tone ?? 'default'],
            )}
          >
            {s.value}
          </div>
          <div className="sublabel mt-0.5 truncate">{s.sub ?? ' '}</div>
        </div>
      ))}
    </Card>
  )
}
