import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { PERIOD_FOR_RANGE } from '@/lib/onlyfans/theonlyapi'

/**
 * Reads the OnlyFans snapshots the sync job writes. Nothing here calls the API
 * — a dashboard should not go down because a third party did.
 */

export interface OfMetrics {
  activeSubs: number
  priorActiveSubs: number | null
  revenueCents: number
  priorRevenueCents: number
  transactions: number
  linkedCreators: number
  unlinkedCreators: string[]
  syncedAt: Date | null
  chart: Array<{ day: string; cents: number }>
}

export async function onlyFansMetrics(rangePreset: string): Promise<OfMetrics> {
  const period = PERIOD_FOR_RANGE[rangePreset] ?? 'week'

  const [latestEarnings, creators, unlinked] = await Promise.all([
    prisma.ofEarningsSnapshot.findFirst({ where: { period }, orderBy: { ts: 'desc' } }),
    prisma.creator.findMany({
      where: { ofUserId: { not: null } },
      select: { id: true, stageName: true },
    }),
    prisma.creator.findMany({
      where: { ofUserId: null, status: { not: 'CHURNED' } },
      select: { stageName: true },
    }),
  ])

  // the most recent snapshot per creator, and the one before it, so the
  // subscriber card can show a real movement rather than a made-up zero
  const rows = creators.length
    ? await prisma.$queryRaw<Array<{ creator_id: string; active: number; rn: number; ts: Date }>>(
        Prisma.sql`
          SELECT "creatorId" AS creator_id, "activeSubs" AS active, ts,
                 ROW_NUMBER() OVER (PARTITION BY "creatorId" ORDER BY ts DESC)::int AS rn
          FROM "OfSubscriberSnapshot"
          WHERE "creatorId" = ANY(${creators.map((c) => c.id)})
        `,
      )
    : []

  const current = rows.filter((r) => r.rn === 1)
  const previous = rows.filter((r) => r.rn === 2)

  const activeSubs = current.reduce((s, r) => s + r.active, 0)
  const priorActiveSubs = previous.length ? previous.reduce((s, r) => s + r.active, 0) : null

  const chart = latestEarnings
    ? latestEarnings.chartDays.map((day, i) => ({
        day,
        cents: latestEarnings.chartCents[i] ?? 0,
      }))
    : []

  return {
    activeSubs,
    priorActiveSubs,
    revenueCents: latestEarnings?.totalCents ?? 0,
    priorRevenueCents: latestEarnings?.prevTotalCents ?? 0,
    transactions: latestEarnings?.transactions ?? 0,
    linkedCreators: creators.length,
    unlinkedCreators: unlinked.map((c) => c.stageName),
    syncedAt:
      latestEarnings?.ts ??
      (current.length ? current.reduce((a, b) => (a.ts > b.ts ? a : b)).ts : null),
    chart,
  }
}
