'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { COMMON_TIMEZONES } from '@/lib/time'
import { updateMyTimezone, updateWorkspace } from './actions'
import { cn } from '@/lib/utils'

export function SettingsForms({
  user,
  workspace,
  canEditWorkspace,
}: {
  user: { name: string; email: string; timezone: string; role: string }
  workspace: {
    name: string
    dayBoundaryTimezone: string
    funnelBaseUrl: string
    attributionWindowH: number
  }
  canEditWorkspace: boolean
}) {
  return (
    <div className="space-y-4">
      <MyPrefs user={user} />
      {canEditWorkspace && <WorkspacePrefs workspace={workspace} />}
    </div>
  )
}

const selectCls =
  'bg-surface-2 border-hairline text-fg text-15 h-8 w-full rounded-[6px] border px-2 outline-none'

function MyPrefs({
  user,
}: {
  user: { name: string; email: string; timezone: string; role: string }
}) {
  const router = useRouter()
  const [tz, setTz] = React.useState(user.timezone)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const options = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES]

  return (
    <Card>
      <div className="border-hairline border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">You</h3>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={user.name} readOnly className="opacity-70" />
          </Field>
          <Field label="Email">
            <Input value={user.email} readOnly className="opacity-70" />
          </Field>
        </div>
        <p className="text-fg-muted text-13">
          Name, email and role are managed by an admin in Admin → Users.
        </p>

        <Field
          label="Display timezone"
          hint="how timestamps are rendered for you — never what a day means"
        >
          <select value={tz} onChange={(e) => setTz(e.target.value)} className={selectCls}>
            {options.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>

        <Button
          variant="primary"
          size="md"
          disabled={busy || tz === user.timezone}
          onClick={async () => {
            setBusy(true)
            setMsg(null)
            const res = await updateMyTimezone(tz)
            setBusy(false)
            setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.error })
            if (res.ok) router.refresh()
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
        {msg && (
          <p className={cn('text-14', msg.ok ? 'text-positive' : 'text-negative')}>{msg.text}</p>
        )}
      </div>
    </Card>
  )
}

function WorkspacePrefs({
  workspace,
}: {
  workspace: {
    name: string
    dayBoundaryTimezone: string
    funnelBaseUrl: string
    attributionWindowH: number
  }
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const options = COMMON_TIMEZONES.includes(workspace.dayBoundaryTimezone)
    ? COMMON_TIMEZONES
    : [workspace.dayBoundaryTimezone, ...COMMON_TIMEZONES]

  return (
    <Card>
      <div className="border-hairline border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">Workspace</h3>
      </div>
      <form
        className="space-y-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setMsg(null)
          const res = await updateWorkspace({
            name: String(f.get('name') ?? ''),
            dayBoundaryTimezone: String(f.get('dayBoundaryTimezone') ?? 'UTC'),
            funnelBaseUrl: String(f.get('funnelBaseUrl') ?? ''),
            attributionWindowH: Number(f.get('attributionWindowH') ?? 72),
          })
          setBusy(false)
          if (res.ok) {
            setMsg({
              ok: true,
              text: res.boundaryChanged
                ? 'Saved. Daily aggregates re-bucket from now on; creation attempts already filed keep the day they were recorded under.'
                : 'Saved.',
            })
            router.refresh()
          } else setMsg({ ok: false, text: res.error })
        }}
      >
        <Field label="Workspace name" required>
          <Input name="name" defaultValue={workspace.name} required />
        </Field>

        <Field
          label="Day boundary timezone"
          required
          hint="what a day means for every daily aggregate in the product"
        >
          <select
            name="dayBoundaryTimezone"
            defaultValue={workspace.dayBoundaryTimezone}
            className={selectCls}
          >
            {options.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Funnel base URL" required hint="the prefix for every account's bio link">
          <Input name="funnelBaseUrl" type="url" defaultValue={workspace.funnelBaseUrl} required />
        </Field>

        <Field
          label="Attribution window (hours)"
          required
          hint="how long after an outbound click a conversion still counts"
        >
          <Input
            name="attributionWindowH"
            type="number"
            min={1}
            max={720}
            defaultValue={workspace.attributionWindowH}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="md" disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save workspace'}
        </Button>
        {msg && (
          <p className={cn('text-14 leading-relaxed', msg.ok ? 'text-positive' : 'text-negative')}>
            {msg.text}
          </p>
        )}
      </form>
    </Card>
  )
}
