import { requireCtx } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { Card } from '@/components/ui/card'
import { dayContextLine, todayKey } from '@/lib/time'
import { SettingsForms } from './settings-forms'

export const metadata = { title: 'Settings · Reddit Ops CRM' }

export default async function SettingsPage() {
  const ctx = await requireCtx()
  const key = todayKey(ctx.workspace.dayBoundaryTimezone)

  return (
    <>
      <PageHeader
        title="Settings"
        context={dayContextLine(key, ctx.workspace.dayBoundaryTimezone, ctx.user.timezone)}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsForms
          user={{
            name: ctx.user.name,
            email: ctx.user.email,
            timezone: ctx.user.timezone,
            role: ctx.user.role,
          }}
          workspace={ctx.workspace}
          canEditWorkspace={ctx.isManager}
        />

        <Card className="p-5 self-start">
          <h3 className="text-15 text-fg mb-2 font-semibold">Why there are two timezones</h3>
          <div className="text-14 text-fg-secondary space-y-2.5 leading-relaxed">
            <p>
              <strong className="text-fg">Workspace day boundary</strong> decides what &ldquo;a
              day&rdquo; means. Every daily aggregate in the product — creation counters, goal bars,
              the employee ranking, the daily ops brief — buckets by this zone. It is a property of
              the operation, not of whoever is looking.
            </p>
            <p>
              <strong className="text-fg">Your display timezone</strong> decides only how an instant
              is rendered for you. Changing it never moves a number between days.
            </p>
            <p>
              A farmer in Lagos, a poster in Manila and a manager in Berlin all see the same daily
              totals and different clock times. Conflating the two is the single most common source
              of &ldquo;the numbers are wrong&rdquo; in an operation spread across timezones, which
              is why every screen carrying a daily figure prints both in its header.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
