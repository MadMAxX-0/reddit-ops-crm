'use client'

import { cn } from '@/lib/utils'
import { Card } from './card'

export function ChartCard({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-1">
        <h3 className="text-15 text-fg font-semibold">{title}</h3>
        {right}
      </div>
      <div className={cn('min-h-0 flex-1 px-1 pt-2 pb-2', bodyClassName)}>{children}</div>
    </Card>
  )
}

/** Segmented range selector used in chart card headers. */
export function RangeSelector<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="bg-surface-2 border-hairline flex items-center gap-0.5 rounded-[6px] border p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'text-13 h-5.5 rounded-[4px] px-2 transition-colors',
            value === opt.value
              ? 'bg-accent-soft text-accent font-medium'
              : 'text-fg-secondary hover:text-fg',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
