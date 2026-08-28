'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        'text-15 relative -mb-px border-b-2 px-3 py-1.5 transition-colors',
        active
          ? 'border-accent text-fg font-medium'
          : 'text-fg-secondary hover:text-fg border-transparent',
      )}
    >
      {children}
    </Link>
  )
}
