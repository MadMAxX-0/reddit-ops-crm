'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LinksTable, type LinkRow } from './links-table'

/**
 * The tracking links, folded under the roster.
 *
 * They used to be their own screen in the rail, which overstated them: the tick
 * that decides what "Reddit revenue" counts is set once and then rarely touched
 * again. It belongs where the accounts are, because a link belongs to an
 * account — and it stays shut until someone asks for it.
 *
 * The open/closed state is remembered, so a manager who works with it open does
 * not have to re-open it on every visit.
 */
export function DeepLinksPanel({
  rows,
  rangeLabel,
  canEdit,
  defaultOpen,
}: {
  rows: LinkRow[]
  rangeLabel: string
  canEdit: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false)

  React.useEffect(() => {
    if (defaultOpen) return
    try {
      setOpen(localStorage.getItem('crm-deeplinks-open') === '1')
    } catch {
      /* private mode — stays shut, which is the safe default */
    }
  }, [defaultOpen])

  function toggle() {
    setOpen((v) => {
      try {
        localStorage.setItem('crm-deeplinks-open', v ? '0' : '1')
      } catch {
        /* nothing to remember it with */
      }
      return !v
    })
  }

  const tracked = rows.filter((r) => r.trackedInCrm).length

  return (
    <div className="bg-surface border-hairline mt-3 overflow-hidden rounded-[10px] border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="hover:bg-surface-2 flex w-full items-center gap-2 px-4 py-3 text-left transition-colors"
      >
        <ChevronRight
          className={cn('text-fg-muted h-4 w-4 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="text-15 text-fg font-medium">Deep links</span>
        <span className="text-13 text-fg-muted">
          {tracked} of {rows.length} counted as Reddit revenue
        </span>
        <span className="text-13 text-fg-muted ml-auto">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-hairline border-t">
          <LinksTable rows={rows} rangeLabel={rangeLabel} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}
