import { cn } from '@/lib/utils'

/**
 * Thin 4px track: orange while behind, info-blue once the target is met.
 * Orange is "the thing being measured, and it is not done yet"; blue is the
 * quiet all-clear. Green is reserved for direction-of-change elsewhere.
 */
export function GoalBar({
  current,
  target,
  showFraction = true,
  className,
  width = 72,
}: {
  current: number
  target: number
  showFraction?: boolean
  className?: string
  width?: number
}) {
  const met = target > 0 && current >= target
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showFraction && (
        <span className="mono text-14 text-fg tabular-nums">
          {current}/{target}
        </span>
      )}
      <span
        className="bg-surface-2 relative h-1 shrink-0 overflow-hidden rounded-full"
        style={{ width }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={target}
      >
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full', met ? 'bg-info' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  )
}
