import { cn } from '@/lib/utils'

export interface RankedItem {
  id: string
  name: string
  type?: string
  value: React.ReactNode
  href?: string
}

/** Numeric rank in muted mono, two-line item, right-aligned value. */
export function RankedList({ items, className }: { items: RankedItem[]; className?: string }) {
  return (
    <ul className={cn('divide-hairline divide-y', className)}>
      {items.map((item, i) => (
        <li key={item.id} className="hover:bg-surface-2 flex items-center gap-3 px-4 py-2.5">
          <span className="mono text-14 text-fg-muted w-5 shrink-0 text-right tabular-nums">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-15 text-fg truncate">{item.name}</div>
            {item.type && <div className="text-fg-muted text-13 truncate">{item.type}</div>}
          </div>
          <div className="mono text-15 text-fg shrink-0 tabular-nums">{item.value}</div>
        </li>
      ))}
    </ul>
  )
}
