import { cn } from '@/lib/utils'
import { fmtDelta } from '@/lib/format'
import { Card } from './card'

/**
 * label (11px secondary) / value (mono 30px) / delta / comparison sub-label,
 * with an optional 40x40 accent-soft icon tile on the right.
 */
export function MetricCard({
  label,
  value,
  deltaPct,
  comparison,
  icon,
  invertDelta = false,
  className,
}: {
  label: string
  value: React.ReactNode
  /** period-over-period change as a ratio, e.g. 0.125 */
  deltaPct?: number | null
  comparison?: string
  icon?: React.ReactNode
  /** for metrics where up is bad — removals, burn rate, removal rate */
  invertDelta?: boolean
  className?: string
}) {
  const good = deltaPct == null ? null : invertDelta ? deltaPct < 0 : deltaPct > 0
  const flat = deltaPct === 0

  return (
    <Card className={cn('flex items-start justify-between gap-3 p-4', className)}>
      <div className="min-w-0">
        <div className="label-xs truncate">{label}</div>
        <div className="kpi mt-1.5">{value}</div>
        {(deltaPct != null || comparison) && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            {deltaPct != null && (
              <span
                className={cn(
                  'mono text-14 font-medium',
                  flat ? 'text-fg-muted' : good ? 'text-positive' : 'text-negative',
                )}
              >
                {fmtDelta(deltaPct)}
              </span>
            )}
            {comparison && <span className="text-fg-muted text-13">{comparison}</span>}
          </div>
        )}
      </div>
      {icon && (
        <div
          className="bg-accent-soft text-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
          aria-hidden
        >
          {icon}
        </div>
      )}
    </Card>
  )
}
