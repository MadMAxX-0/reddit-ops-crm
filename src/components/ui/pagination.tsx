'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import { cn } from '@/lib/utils'

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  noun = 'rows',
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  noun?: string
}) {
  const { set } = useFilterNav()
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="sublabel">
        {fmtNum(first)}–{fmtNum(last)} of {fmtNum(total)} {noun}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => set({ page: String(page - 1) })}
          className={cn(
            'border-hairline flex h-7 w-7 items-center justify-center rounded-[5px] border',
            page <= 1
              ? 'text-fg-muted opacity-40'
              : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
          )}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="mono text-14 text-fg-secondary px-1.5">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => set({ page: String(page + 1) })}
          className={cn(
            'border-hairline flex h-7 w-7 items-center justify-center rounded-[5px] border',
            page >= pageCount
              ? 'text-fg-muted opacity-40'
              : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
          )}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
