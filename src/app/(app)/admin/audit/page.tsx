import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/session'
import { parseFilters } from '@/lib/filters'
import type { Prisma } from '@/generated/prisma/client'
import { PageHeader } from '@/components/shell/page-header'
import { MultiSelectFilter, SelectFilter } from '@/components/filters/multi-select'
import { RangeFilter } from '@/components/filters/range-filter'
import { SearchFilter } from '@/components/filters/search-filter'
import { AuditTable } from './audit-table'

export const metadata = { title: 'Audit logs · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}
function list(v: string | string[] | undefined): string[] {
  if (!v) return []
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).filter(Boolean)
}

export default async function AuditPage(props: PageProps<'/admin/audit'>) {
  const sp = await props.searchParams
  const ctx = await requireAdmin()
  const filters = parseFilters(sp, ctx.workspace.dayBoundaryTimezone, {
    range: '7d',
    pageSize: 100,
  })

  const actorIds = list(sp.actor)
  const entityType = one(sp.entity)
  const action = one(sp.action)

  const where: Prisma.AuditLogWhereInput = {
    ts: { gte: filters.range.start, lt: filters.range.end },
    ...(actorIds.length ? { actorId: { in: actorIds } } : {}),
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(filters.q
      ? {
          OR: [
            { action: { contains: filters.q, mode: 'insensitive' } },
            { entityId: { contains: filters.q, mode: 'insensitive' } },
            { ip: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [rows, total, actors, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { ts: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: { actor: { select: { name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    }),
    prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
  ])

  return (
    <>
      <PageHeader
        title="Audit logs"
        context="Append-only · never editable · credential reveals, reassignments and role changes are always recorded"
        filters={
          <>
            <SearchFilter value={filters.q} placeholder="Action, entity id, IP…" />
            <SelectFilter
              paramKey="action"
              label="Action"
              value={action}
              options={actions.map((a) => ({
                value: a.action,
                label: `${a.action} (${a._count._all})`,
              }))}
            />
            <SelectFilter
              paramKey="entity"
              label="Entity"
              value={entityType}
              options={[
                { value: 'RedditAccount', label: 'Reddit account' },
                { value: 'AccountCreationAttempt', label: 'Creation attempt' },
                { value: 'Post', label: 'Post' },
                { value: 'Subreddit', label: 'Subreddit' },
                { value: 'User', label: 'User' },
                { value: 'Report', label: 'Report' },
                { value: 'ScraperConfig', label: 'Scraper config' },
              ]}
            />
            <MultiSelectFilter
              paramKey="actor"
              label="Actor"
              selected={actorIds}
              options={actors.map((a) => ({
                value: a.id,
                label: a.name,
                sub: a.role.toLowerCase(),
              }))}
            />
            <RangeFilter value={filters.range.preset} from={one(sp.from)} to={one(sp.to)} />
          </>
        }
      />

      <AuditTable
        rows={rows.map((r) => ({
          id: r.id,
          ts: r.ts,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          actorName: r.actor?.name ?? 'system',
          actorRole: r.actor?.role ?? null,
          ip: r.ip,
          before: r.before as unknown,
          after: r.after as unknown,
        }))}
        total={total}
        page={filters.page}
        pageCount={Math.max(1, Math.ceil(total / filters.pageSize))}
        pageSize={filters.pageSize}
        displayTz={ctx.user.timezone}
      />
    </>
  )
}
