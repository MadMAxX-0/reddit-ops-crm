import { cn } from '@/lib/utils'

/**
 * title (20px/600) → tab row → right-aligned filter cluster.
 * `context` is the day-boundary line every daily screen carries.
 */
export function PageHeader({
  title,
  context,
  tabs,
  filters,
  actions,
  className,
}: {
  title: string
  context?: string
  tabs?: React.ReactNode
  filters?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-24 text-fg font-semibold">{title}</h1>
          {context && <p className="sublabel mt-1">{context}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {(tabs || filters) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{tabs}</div>
          <div className="flex flex-wrap items-center gap-2">{filters}</div>
        </div>
      )}
    </div>
  )
}

export function TabRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-hairline flex items-center gap-1 border-b" role="tablist">
      {children}
    </div>
  )
}
