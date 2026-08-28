'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, Download } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatusDot, type Tone } from '@/components/ui/status-dot'
import { fmtTs } from '@/lib/time'
import { cn } from '@/lib/utils'

export interface AuditRow {
  id: string
  ts: Date
  action: string
  entityType: string
  entityId: string | null
  actorName: string
  actorRole: string | null
  ip: string | null
  before: unknown
  after: unknown
}

/** Sensitive actions get a louder dot so they are findable by eye in a long list. */
const ACTION_TONE: Record<string, Tone> = {
  'credential.reveal': 'negative',
  'user.role_change': 'negative',
  'account.reassign': 'warning',
  'account.suspend': 'warning',
  'account.retire': 'warning',
  'subreddit.tier_change': 'info',
  'post.attribution_resolve': 'info',
}

export function AuditTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  displayTz,
}: {
  rows: AuditRow[]
  total: number
  page: number
  pageCount: number
  pageSize: number
  displayTz: string
}) {
  const params = useSearchParams()
  const [open, setOpen] = React.useState<string | null>(null)

  return (
    <Card className="overflow-hidden">
      {rows.length === 0 ? (
        <EmptyState title="Nothing logged in this window." />
      ) : (
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-2">
            <tr>
              {['When', 'Actor', 'Action', 'Entity', 'IP', ''].map((h, i) => (
                <th
                  key={h || i}
                  className="label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hasDiff = r.before != null || r.after != null
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className={cn(
                      'border-hairline hover:bg-surface-2 border-b',
                      hasDiff && 'cursor-pointer',
                    )}
                    onClick={() => hasDiff && setOpen(open === r.id ? null : r.id)}
                  >
                    <td className="mono text-14 text-fg-secondary px-3 py-2 whitespace-nowrap">
                      {fmtTs(r.ts, displayTz)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-14 text-fg leading-tight">{r.actorName}</div>
                      <div className="sublabel">{r.actorRole?.toLowerCase() ?? 'automated'}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusDot
                        tone={ACTION_TONE[r.action] ?? 'muted'}
                        label={<span className="mono text-14">{r.action}</span>}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-14 text-fg leading-tight">{r.entityType}</div>
                      <div className="sublabel truncate">{r.entityId ?? 'bulk'}</div>
                    </td>
                    <td className="mono text-14 text-fg-muted px-3 py-2 whitespace-nowrap">
                      {r.ip ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {hasDiff && (
                        <ChevronDown
                          className={cn(
                            'text-fg-muted inline h-3.5 w-3.5 transition-transform',
                            open === r.id && 'rotate-180',
                          )}
                        />
                      )}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="border-hairline bg-surface-2 border-b">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Diff label="Before" value={r.before} />
                          <Diff label="After" value={r.after} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="border-hairline flex items-center justify-between gap-3 border-t px-3 py-2">
        <a
          href={`/api/audit/export?${params.toString()}`}
          className="text-13 text-fg-secondary hover:text-fg inline-flex items-center gap-1.5"
        >
          <Download className="h-3 w-3" /> Export CSV
        </a>
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          noun="entries"
        />
      </div>
    </Card>
  )
}

function Diff({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="label-xs mb-1">{label}</p>
      <pre className="mono text-13 text-fg-secondary bg-surface border-hairline max-h-48 overflow-auto rounded-[6px] border p-2 whitespace-pre-wrap">
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
