'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Row,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'

const DEFAULT_ROW_HEIGHT = 40

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  /** first column is pinned left by default; pass false for narrow tables */
  pinFirstColumn?: boolean
  /** virtualize once the row count justifies it */
  virtualize?: boolean
  maxHeight?: number
  emptyTitle?: string
  emptyHint?: string
  onRowClick?: (row: T) => void
  rowKey?: (row: T) => string
  initialSorting?: SortingState
  className?: string
  /** renders under the table; used for server-side pagination controls */
  footer?: React.ReactNode
  /** 40px for single-line rows; raise it when the table uses two-line cells,
   *  otherwise the virtualiser's size estimate drifts from the real layout */
  rowHeight?: number
}

export function DataTable<T>({
  columns,
  data,
  pinFirstColumn = true,
  virtualize,
  maxHeight = 620,
  emptyTitle = 'Nothing here.',
  emptyHint,
  onRowClick,
  rowKey,
  initialSorting = [],
  className,
  footer,
  rowHeight = DEFAULT_ROW_HEIGHT,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: rowKey ? (row) => rowKey(row) : undefined,
  })

  const rows = table.getRowModel().rows
  const shouldVirtualize = virtualize ?? rows.length > 80

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: shouldVirtualize,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const paddingTop = shouldVirtualize && virtualRows.length ? virtualRows[0].start : 0
  const paddingBottom =
    shouldVirtualize && virtualRows.length
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0
  const visible: Row<T>[] = shouldVirtualize ? virtualRows.map((v) => rows[v.index]) : rows

  return (
    <div
      className={cn('bg-surface border-hairline overflow-hidden rounded-[8px] border', className)}
    >
      <div ref={containerRef} className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-2 sticky top-0 z-20">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header, i) => {
                  const pinned = pinFirstColumn && i === 0
                  const sortDir = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)
                    ?.align
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'label-xs border-hairline bg-surface-2 h-9 border-b px-3 font-normal whitespace-nowrap',
                        pinned && 'sticky left-0 z-30',
                        align === 'right' && 'text-right',
                        canSort && 'cursor-pointer select-none',
                      )}
                      style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span
                        className={cn(
                          'inline-flex items-center gap-1',
                          align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort &&
                          (sortDir === 'asc' ? (
                            <ArrowUp className="text-accent h-3 w-3" />
                          ) : sortDir === 'desc' ? (
                            <ArrowDown className="text-accent h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="text-fg-muted h-3 w-3 opacity-0 group-hover/head:opacity-100" />
                          ))}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden>
                <td style={{ height: paddingTop }} colSpan={columns.length} />
              </tr>
            )}
            {visible.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'border-hairline group hover:bg-surface-2 border-b',
                  onRowClick && 'cursor-pointer',
                )}
                style={{ height: rowHeight }}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell, i) => {
                  const pinned = pinFirstColumn && i === 0
                  const align = (cell.column.columnDef.meta as { align?: string } | undefined)
                    ?.align
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        'text-14 text-fg px-3 align-middle',
                        // the pinned cell must repaint the row background or the
                        // scrolled-under content shows through it
                        pinned && 'bg-surface group-hover:bg-surface-2 sticky left-0 z-10',
                        align === 'right' && 'text-right',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
            {paddingBottom > 0 && (
              <tr aria-hidden>
                <td style={{ height: paddingBottom }} colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title={emptyTitle} hint={emptyHint} />}
      </div>
      {footer && <div className="border-hairline border-t px-3 py-2">{footer}</div>}
    </div>
  )
}
