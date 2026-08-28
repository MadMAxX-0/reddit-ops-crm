import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/session'
import { parseFilters } from '@/lib/filters'
import { csvResponse, toCsv } from '@/lib/csv'

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin()
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const filters = parseFilters(sp, ctx.workspace.dayBoundaryTimezone, { range: '7d' })

  const rows = await prisma.auditLog.findMany({
    where: {
      ts: { gte: filters.range.start, lt: filters.range.end },
      ...(sp.action ? { action: sp.action } : {}),
      ...(sp.entity ? { entityType: sp.entity } : {}),
    },
    orderBy: { ts: 'desc' },
    take: 50_000,
    include: { actor: { select: { name: true, email: true, role: true } } },
  })

  return csvResponse(
    `audit-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      rows.map((r) => ({
        ts: r.ts.toISOString(),
        actor: r.actor?.name ?? 'system',
        actor_email: r.actor?.email ?? '',
        actor_role: r.actor?.role ?? '',
        action: r.action,
        entity_type: r.entityType,
        entity_id: r.entityId ?? '',
        ip: r.ip ?? '',
        before: r.before ? JSON.stringify(r.before) : '',
        after: r.after ? JSON.stringify(r.after) : '',
      })),
    ),
  )
}
