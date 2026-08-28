'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Icons from 'lucide-react'
import { activeHref, type NavItem } from '@/lib/rbac'
import { cn } from '@/lib/utils'

/**
 * The nav rail: off entirely, narrowed to icons, or open with labels.
 *
 * Two separate choices, because they answer different questions. "Icons or
 * labels" is about how much room the nav deserves; "on or off" is about whether
 * it should be there at all — on a laptop, reading a wide table, it should not.
 * Hiding it leaves one small control pinned where the rail was, so the way back
 * is in the place the thing that vanished used to be.
 *
 * Both are kept in localStorage and read during the first client render rather
 * than in an effect, so the rail never paints one way and jumps to the other.
 * Cmd/Ctrl+B toggles it, the shortcut every editor uses for this.
 */

const STORAGE_KEY = 'nav:expanded'
const VISIBLE_KEY = 'nav:visible'

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ]
  return Cmp ? <Cmp className={className} /> : <Icons.Circle className={className} />
}

function RailLink({
  item,
  active,
  expanded,
}: {
  item: NavItem
  active: boolean
  expanded: boolean
}) {
  // parked sections are shown so the team knows they exist, but they do not
  // navigate anywhere — a link that 404s is worse than one that says "later"
  if (item.parked) {
    return (
      <div
        aria-disabled
        title={`${item.label} — not available yet`}
        className={cn(
          'group text-fg-muted/50 relative flex h-10 cursor-not-allowed items-center rounded-[6px]',
          expanded ? 'w-full gap-3 px-3' : 'w-10 justify-center',
        )}
      >
        <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
        {expanded ? (
          <span className="text-15 truncate">{item.label}</span>
        ) : (
          <span className="bg-surface-2 border-hairline text-14 text-fg-muted pointer-events-none absolute left-12 z-50 hidden whitespace-nowrap rounded-[6px] border px-2 py-1 shadow-lg group-hover:block">
            {item.label} — not available yet
          </span>
        )}
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-[6px] transition-colors',
        expanded ? 'w-full gap-3 px-3' : 'w-10 justify-center',
        active ? 'text-accent bg-accent-soft' : 'text-fg-muted hover:text-fg hover:bg-surface-2',
      )}
    >
      {/* orange left-edge indicator on the active item */}
      {active && (
        <span className="bg-accent absolute -left-[10px] h-5 w-[2px] rounded-r-full" aria-hidden />
      )}
      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
      {expanded ? (
        <span className="text-15 truncate">{item.label}</span>
      ) : (
        <span className="bg-surface-2 border-hairline text-14 text-fg pointer-events-none absolute left-12 z-50 hidden whitespace-nowrap rounded-[6px] border px-2 py-1 shadow-lg group-hover:block">
          {item.label}
        </span>
      )}
    </Link>
  )
}

export function IconRail({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const active = activeHref(pathname)
  const main = items.filter((i) => i.section === 'main')
  const admin = items.filter((i) => i.section === 'admin')

  const [expanded, setExpanded] = React.useState(() =>
    typeof window === 'undefined' ? false : window.localStorage.getItem(STORAGE_KEY) === '1',
  )
  // defaults to on: a nav you have to discover is worse than one you have to close
  const [visible, setVisible] = React.useState(() =>
    typeof window === 'undefined' ? true : window.localStorage.getItem(VISIBLE_KEY) !== '0',
  )

  function toggle() {
    setExpanded((prev) => {
      const next = !prev
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  const toggleVisible = React.useCallback(() => {
    setVisible((prev) => {
      const next = !prev
      window.localStorage.setItem(VISIBLE_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleVisible()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleVisible])

  if (!visible) {
    return (
      <button
        type="button"
        onClick={toggleVisible}
        aria-label="Show sidebar"
        title="Show sidebar  (⌘B)"
        className="bg-surface border-hairline text-fg-muted hover:text-fg hover:bg-surface-2 fixed top-3 left-3 z-50 flex h-8 w-8 items-center justify-center rounded-[7px] border shadow-lg transition-colors"
      >
        <Icons.PanelLeftOpen className="h-4 w-4" />
      </button>
    )
  }

  return (
    <nav
      className={cn(
        'bg-surface border-hairline sticky top-0 flex h-dvh shrink-0 flex-col gap-1 border-r py-3 transition-[width]',
        expanded ? 'w-56 items-stretch px-2' : 'w-14 items-center',
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center',
          expanded ? 'justify-between px-1' : 'flex-col gap-2',
        )}
      >
        <Link href="/" className="flex h-8 items-center gap-2" aria-label="Home">
          <span className="bg-accent text-15 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] font-bold text-white">
            R
          </span>
          {expanded && <span className="text-15 text-fg font-semibold">Reddit Ops</span>}
        </Link>
        <div className={cn('flex shrink-0 items-center', expanded ? 'gap-0.5' : 'flex-col gap-1')}>
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? 'Narrow to icons' : 'Show labels'}
            title={expanded ? 'Narrow to icons' : 'Show labels'}
            className="text-fg-muted hover:text-fg hover:bg-surface-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors"
          >
            {expanded ? (
              <Icons.ChevronsLeft className="h-4 w-4" />
            ) : (
              <Icons.ChevronsRight className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleVisible}
            aria-label="Hide sidebar"
            title="Hide sidebar  (⌘B)"
            className="text-fg-muted hover:text-fg hover:bg-surface-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors"
          >
            <Icons.PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {main.map((item) => (
        <RailLink key={item.href} item={item} active={active === item.href} expanded={expanded} />
      ))}

      {admin.length > 0 && (
        <>
          <div
            className={cn('bg-hairline my-2 h-px shrink-0', expanded ? 'w-full' : 'w-6')}
            aria-hidden
          />
          {admin.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              active={active === item.href}
              expanded={expanded}
            />
          ))}
        </>
      )}
    </nav>
  )
}
