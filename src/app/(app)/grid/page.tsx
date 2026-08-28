import { requireCtx } from '@/lib/session'
import { buildGrid } from '@/lib/queries/grid'
import { dayContextLine, todayKey } from '@/lib/time'
import { PageHeader } from '@/components/shell/page-header'
import { GridBoard } from './grid-board'

export const metadata = { title: 'Grid · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function GridPage(props: PageProps<'/grid'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const boundaryTz = ctx.workspace.dayBoundaryTimezone
  const days = Math.min(60, Math.max(7, Number(one(sp.days) ?? 14) || 14))

  const grid = await buildGrid(boundaryTz, days)

  // A poster sees only their own section. Nobody else's row is theirs to read.
  const sections = ctx.isManager
    ? grid.sections
    : grid.sections.filter((s) => s.posterId === ctx.user.id)

  return (
    <>
      <PageHeader
        title="Grid"
        context={`${dayContextLine(todayKey(boundaryTz), boundaryTz, ctx.user.timezone)} · last ${days} days · every mark is a discovered post`}
      />
      <GridBoard
        days={grid.days}
        sections={sections}
        unassigned={ctx.isManager ? grid.unassigned : []}
        windowDays={days}
        displayTz={ctx.user.timezone}
      />
    </>
  )
}
