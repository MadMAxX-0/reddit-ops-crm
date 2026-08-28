'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Monitor, Pencil, Plus, RotateCcw, UserMinus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { StatusDot } from '@/components/ui/status-dot'
import { fmtMoney, fmtNum } from '@/lib/format'
import { fmtTs, COMMON_TIMEZONES } from '@/lib/time'
import { ROLE_LABEL, type Role } from '@/lib/rbac'
import { createUser, deactivateUser, reactivateUser, resetPassword, updateUser } from './actions'
import { cn } from '@/lib/utils'

export interface UserRow {
  id: string
  name: string
  email: string
  role: string
  timezone: string
  status: string
  dailyAccountGoal: number
  dailyPostGoal: number
  hourlyCostCents: number
  createdAt: Date
  creatorIds: string[]
  creatorNames: string[]
  assignedAccounts: number
  createdAccounts: number
  posts: number
}

const ROLES: Role[] = ['POSTER', 'FARMER', 'MANAGER', 'ADMIN']

export function UsersTable({
  users,
  creators,
  currentUserId,
  displayTz,
}: {
  users: UserRow[]
  creators: { id: string; name: string }[]
  currentUserId: string
  displayTz: string
}) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" size="md" onClick={() => setCreating((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> New user
        </Button>
      </div>

      {creating && <UserForm creators={creators} onDone={() => setCreating(false)} />}

      <Card className="overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-2">
            <tr>
              {[
                'Name',
                'Role',
                'Timezone',
                'Goals',
                'Creators',
                'Inventory',
                'Cost/h',
                'Joined',
                '',
              ].map((h, i) => (
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
            {users.map((u) => (
              <React.Fragment key={u.id}>
                <tr
                  className={cn(
                    'border-hairline hover:bg-surface-2 border-b',
                    u.status !== 'ACTIVE' && 'opacity-55',
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={u.status === 'ACTIVE' ? 'positive' : 'muted'} />
                      <div className="min-w-0">
                        <div className="text-15 text-fg truncate leading-tight">{u.name}</div>
                        <div className="sublabel truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-14 text-fg px-3 py-2.5">
                    {ROLE_LABEL[u.role as Role] ?? u.role}
                  </td>
                  <td className="mono text-14 text-fg-secondary px-3 py-2.5">{u.timezone}</td>
                  <td className="px-3 py-2.5">
                    <div className="mono text-14 text-fg leading-tight">
                      {u.role === 'FARMER'
                        ? `${u.dailyAccountGoal}/day`
                        : u.role === 'POSTER'
                          ? `${u.dailyPostGoal}/day`
                          : '—'}
                    </div>
                    <div className="sublabel">
                      {u.role === 'FARMER'
                        ? 'accounts'
                        : u.role === 'POSTER'
                          ? 'posts'
                          : 'not scored'}
                    </div>
                  </td>
                  <td className="text-14 text-fg-secondary max-w-[16rem] px-3 py-2.5">
                    <span className="block truncate">
                      {u.creatorNames.length ? u.creatorNames.join(', ') : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="mono text-14 text-fg leading-tight">
                      {fmtNum(u.role === 'FARMER' ? u.createdAccounts : u.assignedAccounts)}
                    </div>
                    <div className="sublabel">
                      {u.role === 'FARMER' ? 'made' : 'assigned'} · {fmtNum(u.posts)} posts
                    </div>
                  </td>
                  <td className="mono text-14 text-fg-secondary px-3 py-2.5">
                    {u.hourlyCostCents ? fmtMoney(u.hourlyCostCents) : '—'}
                  </td>
                  <td className="mono text-14 text-fg-muted px-3 py-2.5 whitespace-nowrap">
                    {fmtTs(u.createdAt, displayTz).slice(0, 10)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {/* what this person sees when they sign in — the quickest
                          way to check a permission is to look at their screen */}
                      <Button size="sm" variant="ghost" asChild>
                        <Link
                          href={`/admin/users/${u.id}/view`}
                          aria-label={`View what ${u.name} sees`}
                          title={`View what ${u.name} sees`}
                        >
                          <Monitor className="h-3 w-3" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(editing === u.id ? null : u.id)}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <DeactivateButton
                        user={u}
                        posters={users.filter(
                          (x) => x.role === 'POSTER' && x.status === 'ACTIVE' && x.id !== u.id,
                        )}
                        disabled={u.id === currentUserId}
                      />
                    </div>
                  </td>
                </tr>
                {editing === u.id && (
                  <tr className="border-hairline bg-surface-2 border-b">
                    <td colSpan={9} className="px-3 py-3">
                      <UserForm user={u} creators={creators} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function DeactivateButton({
  user,
  posters,
  disabled,
}: {
  user: UserRow
  posters: UserRow[]
  disabled: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [reassignTo, setReassignTo] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (user.status !== 'ACTIVE') {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await reactivateUser(user.id)
          setBusy(false)
          router.refresh()
        }}
        aria-label="Reactivate"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    )
  }

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        aria-label="Deactivate"
        title={disabled ? 'You cannot deactivate yourself' : 'Deactivate'}
      >
        <UserMinus className="h-3 w-3" />
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {user.assignedAccounts > 0 && (
        <select
          value={reassignTo}
          onChange={(e) => setReassignTo(e.target.value)}
          className="bg-surface border-hairline text-13 text-fg h-6 rounded-[5px] border px-1.5 outline-none"
        >
          <option value="">unassign {user.assignedAccounts} accounts</option>
          {posters.map((p) => (
            <option key={p.id} value={p.id}>
              hand to {p.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await deactivateUser(user.id, reassignTo || undefined)
          setBusy(false)
          if (res.ok) {
            setConfirming(false)
            router.refresh()
          } else setError(res.error)
        }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-13 text-fg-muted hover:text-fg"
      >
        cancel
      </button>
      {error && <span className="text-negative text-13">{error}</span>}
    </div>
  )
}

function UserForm({
  user,
  creators,
  onDone,
}: {
  user?: UserRow
  creators: { id: string; name: string }[]
  onDone: () => void
}) {
  const router = useRouter()
  const [role, setRole] = React.useState<Role>((user?.role as Role) ?? 'POSTER')
  const [creatorIds, setCreatorIds] = React.useState<string[]>(user?.creatorIds ?? [])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pwd, setPwd] = React.useState('')

  const inputCls =
    'bg-surface-2 border-hairline text-fg text-15 h-8 w-full rounded-[6px] border px-2 outline-none'

  return (
    <Card className="p-4">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const payload = {
            name: String(f.get('name') ?? ''),
            email: String(f.get('email') ?? ''),
            role,
            timezone: String(f.get('timezone') ?? 'UTC'),
            dailyAccountGoal: Number(f.get('dailyAccountGoal') ?? 0),
            dailyPostGoal: Number(f.get('dailyPostGoal') ?? 0),
            hourlyCostCents: Number(f.get('hourlyCostCents') ?? 0),
            creatorIds,
          }
          setBusy(true)
          setError(null)
          const res = user
            ? await updateUser(user.id, payload)
            : await createUser({ ...payload, password: String(f.get('password') ?? '') })
          setBusy(false)
          if (res.ok) {
            onDone()
            router.refresh()
          } else setError(res.error)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" required>
            <Input name="name" defaultValue={user?.name} required />
          </Field>
          <Field label="Email" required>
            <Input name="email" type="email" defaultValue={user?.email} required />
          </Field>
          <Field label="Role" required>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Display timezone" required hint="how they see timestamps">
            <select name="timezone" defaultValue={user?.timezone ?? 'UTC'} className={inputCls}>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Daily account goal" hint="farmers">
            <Input
              name="dailyAccountGoal"
              type="number"
              min={0}
              defaultValue={user?.dailyAccountGoal ?? 0}
            />
          </Field>
          <Field label="Daily post goal" hint="posters">
            <Input
              name="dailyPostGoal"
              type="number"
              min={0}
              defaultValue={user?.dailyPostGoal ?? 0}
            />
          </Field>
          <Field label="Hourly cost (cents)" hint="feeds revenue per VA hour">
            <Input
              name="hourlyCostCents"
              type="number"
              min={0}
              defaultValue={user?.hourlyCostCents ?? 0}
            />
          </Field>
        </div>

        <div>
          <span className="label-xs mb-1.5 block">Creators they may work</span>
          <div className="flex flex-wrap gap-1.5">
            {creators.map((c) => {
              const on = creatorIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setCreatorIds((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                  }
                  className={cn(
                    'border-hairline text-14 rounded-[5px] border px-2 py-1 transition-colors',
                    on
                      ? 'bg-accent-soft border-accent/40 text-accent'
                      : 'bg-surface-2 text-fg-secondary hover:text-fg',
                  )}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>

        {!user && (
          <Field label="Initial password" required hint="at least 8 characters">
            <Input name="password" type="password" minLength={8} required />
          </Field>
        )}

        {error && <p className="text-negative text-14">{error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : user ? (
              'Save'
            ) : (
              'Create user'
            )}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={onDone}>
            Cancel
          </Button>

          {user && (
            <div className="ml-auto flex items-center gap-2">
              <Input
                type="password"
                placeholder="New password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="w-44"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={pwd.length < 8 || busy}
                onClick={async () => {
                  setBusy(true)
                  const res = await resetPassword(user.id, pwd)
                  setBusy(false)
                  setPwd('')
                  if (!res.ok) setError(res.error)
                }}
              >
                Reset password
              </Button>
            </div>
          )}
        </div>
      </form>
    </Card>
  )
}
