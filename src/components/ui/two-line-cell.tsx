import { cn } from '@/lib/utils'

/**
 * The core cell pattern of the whole app: a primary value with a small muted
 * secondary line underneath carrying the qualifier.
 *
 *   15                     22/22
 *   8 failed on create     0 active · 0 refund
 *
 * The qualifier is what stops someone reading "15 accounts" as unqualified
 * success, so it is a first-class part of the cell rather than a tooltip.
 */
export function TwoLineCell({
  value,
  sub,
  tone,
  align = 'left',
  className,
}: {
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'accent' | 'positive' | 'negative' | 'warning' | 'muted'
  align?: 'left' | 'right'
  className?: string
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'positive'
        ? 'text-positive'
        : tone === 'negative'
          ? 'text-negative'
          : tone === 'warning'
            ? 'text-warning'
            : tone === 'muted'
              ? 'text-fg-muted'
              : 'text-fg'

  return (
    <div className={cn('leading-tight', align === 'right' && 'text-right', className)}>
      <div className={cn('mono text-15', toneClass)}>{value}</div>
      {sub != null && <div className="sublabel mt-0.5 truncate">{sub}</div>}
    </div>
  )
}
