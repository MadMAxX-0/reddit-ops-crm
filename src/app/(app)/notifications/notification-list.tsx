'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusDot, type Tone } from '@/components/ui/status-dot'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import { fmtRelative, fmtTs } from '@/lib/time'
import { markAllRead, markRead } from './actions'
import { cn } from '@/lib/utils'

const TONE: Record<string, Tone> = { CRITICAL: 'negative', WARN: 'warning', INFO: 'info' }

export function NotificationList({
  notifications,
  unread,
  unreadOnly,
  displayTz,
}: {
  notifications: Array<{
    id: string
    severity: string
    title: string
    body: string | null
    href: string | null
    readAt: Date | null
    createdAt: Date
  }>
  unread: number
  unreadOnly: boolean
  displayTz: string
}) {
  const router = useRouter()
  const { set } = useFilterNav()
  const [busy, setBusy] = React.useState(false)

  return (
    <Card>
      <div className="border-hairline flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="bg-surface-2 border-hairline flex items-center gap-0.5 rounded-[6px] border p-0.5">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => set({ unread: v ? '1' : null })}
              className={cn(
                'text-13 h-6 rounded-[4px] px-2.5 transition-colors',
                unreadOnly === v
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-fg-secondary hover:text-fg',
              )}
            >
              {v ? `Unread (${unread})` : 'All'}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || unread === 0}
          onClick={async () => {
            setBusy(true)
            await markAllRead()
            setBusy(false)
            router.refresh()
          }}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Mark all read
        </Button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread. Good.' : 'Nothing here yet.'}
          hint="Removals, suspensions, goal misses and scraper failures land here."
        />
      ) : (
        <ul className="divide-hairline divide-y">
          {notifications.map((n) => {
            const inner = (
              <div className="flex items-start gap-3 px-4 py-3">
                <StatusDot tone={TONE[n.severity] ?? 'muted'} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn('text-15 truncate', n.readAt ? 'text-fg-secondary' : 'text-fg')}
                  >
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="text-fg-muted text-13 mt-0.5 leading-snug">{n.body}</div>
                  )}
                </div>
                <span className="sublabel shrink-0" title={fmtTs(n.createdAt, displayTz)}>
                  {fmtRelative(n.createdAt)} ago
                </span>
                {!n.readAt && (
                  <span className="bg-accent mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                )}
              </div>
            )
            return (
              <li key={n.id} className={cn('hover:bg-surface-2', !n.readAt && 'bg-accent-soft/25')}>
                {n.href ? (
                  <Link
                    href={n.href}
                    onClick={() => {
                      if (!n.readAt) void markRead([n.id])
                    }}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={async () => {
                      if (n.readAt) return
                      await markRead([n.id])
                      router.refresh()
                    }}
                  >
                    {inner}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
