'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Bell, ChevronDown, Search } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ROLE_LABEL, type Role } from '@/lib/rbac'

export function TopBar({
  workspaceName,
  user,
  unreadCount,
}: {
  workspaceName: string
  user: { name: string; email: string; role: Role; timezone: string }
  unreadCount: number
}) {
  const router = useRouter()

  return (
    <header className="bg-surface border-hairline sticky top-0 z-40 flex h-[52px] shrink-0 items-center gap-4 border-b px-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-16 text-fg truncate font-semibold">{workspaceName}</span>
        <span className="text-fg-muted text-13 hidden truncate sm:inline">Reddit operations</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <form
          className="relative hidden md:block"
          onSubmit={(e) => {
            e.preventDefault()
            const q = new FormData(e.currentTarget).get('q')
            if (q) router.push(`/search?q=${encodeURIComponent(String(q))}`)
          }}
        >
          <Search className="text-fg-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            name="q"
            placeholder="Search accounts, posts, creators…"
            className="bg-surface-2 border-hairline text-14 text-fg placeholder:text-fg-muted h-8 w-72 rounded-[6px] border pr-2.5 pl-8 outline-none focus:border-[#4a4a4a]"
          />
        </form>

        <Link
          href="/notifications"
          aria-label={`Notifications, ${unreadCount} unread`}
          className="text-fg-secondary hover:bg-surface-2 hover:text-fg relative flex h-8 w-8 items-center justify-center rounded-[6px]"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="bg-accent mono absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[12px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="hover:bg-surface-2 flex h-8 items-center gap-2 rounded-[6px] px-2 outline-none">
            <span className="bg-accent-soft text-accent text-13 flex h-6 w-6 items-center justify-center rounded-full font-semibold">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="text-14 text-fg block">{user.name}</span>
              <span className="text-fg-muted block text-[12px]">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronDown className="text-fg-muted h-3 w-3" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="bg-surface border-hairline z-50 w-56 rounded-[8px] border py-1 shadow-xl"
            >
              <div className="border-hairline border-b px-3 py-2">
                <div className="text-14 text-fg truncate">{user.email}</div>
                <div className="sublabel mt-0.5">{user.timezone}</div>
              </div>
              <DropdownMenu.Item asChild>
                <Link
                  href="/settings"
                  className="text-14 text-fg-secondary hover:bg-surface-2 hover:text-fg block cursor-pointer px-3 py-1.5 outline-none"
                >
                  Settings
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => signOut({ callbackUrl: '/login' })}
                className="text-14 text-fg-secondary hover:bg-surface-2 hover:text-fg cursor-pointer px-3 py-1.5 outline-none"
              >
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
