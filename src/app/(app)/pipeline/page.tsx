import { requireCtx } from '@/lib/session'
import { loadPipeline } from '@/lib/queries/pipeline'
import { creationTracking, farmingTracking, pipelineSummary } from '@/lib/queries/va-tracking'
import { todayKey } from '@/lib/time'
import { PipelineTable } from './pipeline-table'
import { CreationTracking, FarmingTracking } from './tracking'
import { Supply } from './supply'

export const metadata = { title: 'Pipeline · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function PipelinePage(props: PageProps<'/pipeline'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()

  const stage = one(sp.stage) ?? null
  const device = one(sp.device) ?? null
  const q = one(sp.q)?.trim() ?? ''

  const boundaryTz = ctx.workspace.dayBoundaryTimezone
  const key = one(sp.day) ?? todayKey(boundaryTz)

  // farming is judged over the calendar month the chosen day falls in
  const monthStart = new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`)
  const monthEnd = new Date(monthStart)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

  const [{ rows, stageCounts, deviceCounts, devices }, creators, farmers, supply] =
    await Promise.all([
      loadPipeline({ stage, device, q }),
      creationTracking(boundaryTz, key),
      farmingTracking(monthStart, monthEnd),
      pipelineSummary(),
    ])

  return (
    <div className="space-y-4">
      <Supply s={supply} />
      <CreationTracking rows={creators} dayLabel={key} />
      <FarmingTracking
        rows={farmers}
        monthLabel={monthStart.toLocaleDateString('en-GB', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })}
      />
      <PipelineTable
        rows={rows.map((r) => ({
          ...r,
          lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
        }))}
        stageCounts={stageCounts}
        devices={devices}
        deviceCounts={deviceCounts}
        stageFilter={stage}
        deviceFilter={device}
        q={q}
        canEdit={ctx.isManager || ctx.user.role === 'FARMER'}
        canRemove={ctx.isManager}
      />
    </div>
  )
}
