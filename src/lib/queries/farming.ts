import { prisma } from '@/lib/prisma'

/**
 * The accounts being warmed up.
 *
 * Read from the accounts themselves, not from logged sessions. Warm-up is
 * mostly waiting — an account gets older and gains karma whether or not anyone
 * sat with it — so the question worth answering is "which of these are ready,
 * and which have stalled", and both come from Reddit for free.
 */

export interface FarmingRow {
  id: string
  username: string
  device: string | null
  ageDays: number | null
  karmaPost: number
  karmaComment: number
  totalKarma: number
  /** karma gained since the oldest health reading we hold, and over how long */
  karmaGained: number | null
  gainedOverDays: number | null
  flag: string
  status: string
  shadowbanned: boolean
  lastCheckedAt: Date | null
}

export interface FarmingSummary {
  total: number
  withKarma: number
  flagged: number
  neverChecked: number
  byDevice: Array<{ device: string; count: number }>
  /** old enough to hand to a poster, by the workspace's own reckoning */
  readyAgeDays: number
  ready: number
}

export async function farmingAccounts(readyAgeDays = 21): Promise<{
  rows: FarmingRow[]
  summary: FarmingSummary
}> {
  const accounts = await prisma.redditAccount.findMany({
    where: { pipelineStage: 'FARMING' },
    orderBy: [{ device: 'asc' }, { username: 'asc' }],
    select: {
      id: true,
      username: true,
      device: true,
      karmaPost: true,
      karmaComment: true,
      flag: true,
      status: true,
      shadowbanned: true,
      lastCheckedAt: true,
      redditCreatedAt: true,
      healthSnapshots: {
        orderBy: { capturedAt: 'asc' },
        take: 1,
        select: { karmaPost: true, karmaComment: true, capturedAt: true },
      },
    },
  })

  const now = Date.now()
  const rows: FarmingRow[] = accounts.map((a) => {
    const ageDays = a.redditCreatedAt
      ? Math.floor((now - a.redditCreatedAt.getTime()) / 86_400_000)
      : null
    const first = a.healthSnapshots[0]
    const total = a.karmaPost + a.karmaComment
    return {
      id: a.id,
      username: a.username,
      device: a.device,
      ageDays,
      karmaPost: a.karmaPost,
      karmaComment: a.karmaComment,
      totalKarma: total,
      karmaGained: first ? total - (first.karmaPost + first.karmaComment) : null,
      gainedOverDays: first
        ? Math.max(1, Math.round((now - first.capturedAt.getTime()) / 86_400_000))
        : null,
      flag: a.flag,
      status: a.status,
      shadowbanned: a.shadowbanned,
      lastCheckedAt: a.lastCheckedAt,
    }
  })

  const byDevice = new Map<string, number>()
  for (const r of rows)
    byDevice.set(r.device ?? '— no device —', (byDevice.get(r.device ?? '— no device —') ?? 0) + 1)

  return {
    rows,
    summary: {
      total: rows.length,
      withKarma: rows.filter((r) => r.totalKarma > 0).length,
      flagged: rows.filter((r) => r.flag !== 'NONE' || r.shadowbanned).length,
      neverChecked: rows.filter((r) => !r.lastCheckedAt).length,
      byDevice: [...byDevice.entries()]
        .map(([device, count]) => ({ device, count }))
        .sort((a, b) => b.count - a.count),
      readyAgeDays,
      ready: rows.filter((r) => (r.ageDays ?? 0) >= readyAgeDays && r.flag === 'NONE').length,
    },
  }
}
