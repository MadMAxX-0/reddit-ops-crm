'use client'

import Link from 'next/link'
import * as React from 'react'
import * as Icons from 'lucide-react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Card } from '@/components/ui/card'
import { fmtNum } from '@/lib/format'
import type { NavItem } from '@/lib/rbac'
import { cn } from '@/lib/utils'

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ]
  return Cmp ? <Cmp className={className} /> : <Icons.Circle className={className} />
}

interface RouteRow {
  href: string
  label: string
  section: string
  parked: boolean
  allowed: boolean
  inRail: boolean
}

const SECTIONS: { key: string; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'admin', label: 'Admin' },
]

export function RoleView({
  user,
  nav,
  landing,
  routes,
}: {
  user: {
    id: string
    name: string
    email: string
    role: string
    roleLabel: string
    status: string
    timezone: string
    goal: string
    accounts: number
    accountsLabel: string
    posts: number
  }
  nav: NavItem[]
  landing: string
  routes: RouteRow[]
}) {
  const open = routes.filter((r) => r.allowed).length

  return (
    <>
      <PageHeader
        title={`What ${user.name.split(' ')[0]} sees`}
        context={`${user.roleLabel} · ${user.email} · lands on ${landing} · ${user.timezone}`}
        actions={
          <Link
            href="/admin/users"
            className="text-14 text-fg-secondary hover:text-fg inline-flex h-8 items-center gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to users
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* the rail, drawn the way the app draws it for this role */}
        <Card className="overflow-hidden">
          <div className="border-hairline text-13 text-fg-muted border-b px-4 py-2.5">
            Their sidebar · {nav.length} entries
          </div>
          <div className="flex flex-col gap-0.5 p-2">
            {SECTIONS.map((s) => {
              const items = nav.filter((n) => n.section === s.key)
              if (!items.length) return null
              return (
                <React.Fragment key={s.key}>
                  <div className="label-xs text-fg-muted px-2 pt-3 pb-1.5">{s.label}</div>
                  {items.map((item) => (
                    <div
                      key={item.href}
                      className={cn(
                        'text-15 flex items-center gap-2.5 rounded-[7px] px-2.5 py-2',
                        item.parked
                          ? 'text-fg-muted/60'
                          : item.href === landing
                            ? 'bg-surface-2 text-fg font-medium'
                            : 'text-fg-secondary',
                      )}
                    >
                      <Icon name={item.icon} className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.parked && (
                        <span className="text-fg-muted/60 mono ml-auto text-[12px]">
                          rebuilding
                        </span>
                      )}
                      {item.href === landing && !item.parked && (
                        <span className="text-fg-muted mono ml-auto text-[12px]">lands here</span>
                      )}
                    </div>
                  ))}
                </React.Fragment>
              )
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Sidebar entries" value={fmtNum(nav.length)} sub={`${open} routes open`} />
            <Stat
              label={`Accounts ${user.accountsLabel}`}
              value={fmtNum(user.accounts)}
              sub={user.goal}
            />
            <Stat label="Posts" value={fmtNum(user.posts)} sub="all time" />
          </div>

          <Card className="overflow-hidden">
            <div className="border-hairline text-13 text-fg-muted border-b px-4 py-2.5">
              Every route, and what {user.name.split(' ')[0]} gets from it
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="bg-surface-2">
                  <tr>
                    {['Route', 'Section', 'Result', 'In their sidebar'].map((h) => (
                      <th
                        key={h}
                        className="label-xs border-hairline h-9 border-b px-4 font-normal whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.href} className="border-hairline border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="mono text-14 text-fg">{r.href}</div>
                        <div className="text-13 text-fg-muted">{r.label}</div>
                      </td>
                      <td className="text-14 text-fg-secondary px-4 py-2.5 capitalize">
                        {r.section}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.parked ? (
                          <Tag tone="muted">404 · rebuilding</Tag>
                        ) : r.allowed ? (
                          <Tag tone="ok">opens</Tag>
                        ) : (
                          <Tag tone="warn">sent to {landing}</Tag>
                        )}
                      </td>
                      <td className="text-14 text-fg-secondary px-4 py-2.5">
                        {r.inRail ? (r.parked ? 'listed, greyed' : 'listed') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-fg-muted text-13 leading-relaxed">
            This is a preview, not a session swap — you are still signed in as yourself. Borrowing{' '}
            {user.name.split(' ')[0]}&rsquo;s identity to check a permission would file your actions
            under her name in the audit log, and that record has to stay truthful. To browse the app
            as she does, sign in as <span className="mono text-fg-secondary">{user.email}</span>.{' '}
            <Link href={landing} className="text-info inline-flex items-center gap-1">
              Open her landing page <ExternalLink className="h-3 w-3" />
            </Link>
          </p>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <span className="text-13 text-fg-muted">{label}</span>
      <span className="mono text-24 text-fg font-medium">{value}</span>
      <span className="text-13 text-fg-muted">{sub}</span>
    </Card>
  )
}

function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'text-13 mono inline-block rounded-full border px-2 py-0.5 whitespace-nowrap',
        tone === 'ok' && 'text-positive border-positive/35 bg-positive/10',
        tone === 'warn' && 'text-warning border-warning/30 bg-warning/8',
        tone === 'muted' && 'text-fg-muted border-hairline',
      )}
    >
      {children}
    </span>
  )
}
