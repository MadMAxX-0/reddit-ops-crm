import { cn } from '@/lib/utils'

/** Declarative, not apologetic. "Nothing overdue. Good." */
export function EmptyState({
  title,
  hint,
  className,
}: {
  title: string
  hint?: string
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-4 py-10 text-center', className)}
    >
      <p className="text-fg-secondary text-15">{title}</p>
      {hint && <p className="text-fg-muted text-13 mt-1">{hint}</p>}
    </div>
  )
}
