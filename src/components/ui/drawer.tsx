'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

/**
 * URL-driven detail drawer. State lives in the query string so a drawer view
 * is linkable and survives a refresh, which matters when someone is pasting a
 * specific account into Slack.
 */
export function UrlDrawer({
  paramKey,
  title,
  subtitle,
  children,
  width = 720,
}: {
  paramKey: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  width?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function close() {
    const sp = new URLSearchParams(params)
    sp.delete(paramKey)
    const qs = sp.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
      />
      <aside
        className={cn(
          'bg-surface border-hairline relative flex h-full flex-col border-l shadow-2xl',
        )}
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <div className="border-hairline flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-16 text-fg truncate font-semibold">{title}</div>
            {subtitle && <div className="sublabel mt-0.5 truncate">{subtitle}</div>}
          </div>
          <button
            onClick={close}
            className="text-fg-muted hover:bg-surface-2 hover:text-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  )
}

export function DrawerSection({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-hairline border-b px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="label-xs">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  )
}

export function KeyValue({ items }: { items: Array<{ k: string; v: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {items.map(({ k, v }) => (
        <div key={k} className="min-w-0">
          <dt className="text-fg-muted text-13">{k}</dt>
          <dd className="mono text-14 text-fg truncate">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
