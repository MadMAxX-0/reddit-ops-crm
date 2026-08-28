import { prisma } from '@/lib/prisma'
import type { RemovedBy } from '@/generated/prisma/client'
import { IN_ROTATION, ROTATION_ACCOUNT } from './rotation'

/**
 * How much went out, and how much of it survived — per account and in total,
 * across 24h / 7d / 30d.
 *
 * Two deliberate choices:
 *
 *  - A post is counted in the window it was POSTED in, and its removal counts
 *    against that same window however much later it happened. The alternative
 *    (counting removals when they occur) makes a window's removal rate exceed
 *    100% whenever an old post dies today, and the question being asked is
 *    "how did the work we did that week hold up".
 *  - Mod removals and Reddit-filter removals are never summed. They mean
 *    opposite things — see `classifyRemoval`.
 */
export type Window = '24h' | '7d' | '30d'

export const WINDOW_HOURS: Record<Window, number> = { '24h': 24, '7d': 168, '30d': 720 }

export interface VolumeCell {
  posted: number
  live: number
  byMod: number
  byReddit: number
  byAuthor: number
  unknown: number
}

export interface AccountVolume {
  accountId: string
  username: string
  status: string
  /** null when the account has never posted at all */
  lastPostAt: Date | null
  lifetime: number
  windows: Record<Window, VolumeCell>
}

const EMPTY = (): VolumeCell => ({
  posted: 0,
  live: 0,
  byMod: 0,
  byReddit: 0,
  byAuthor: 0,
  unknown: 0,
})

const BUCKET: Record<RemovedBy, keyof VolumeCell> = {
  MOD: 'byMod',
  REDDIT: 'byReddit',
  AUTHOR: 'byAuthor',
  UNKNOWN: 'unknown',
}

export async function postingVolume(now = new Date()) {
  const oldest = new Date(now.getTime() - WINDOW_HOURS['30d'] * 3_600_000)

  // One read covers all three windows: 30d is a superset of 7d and 24h, so
  // three queries would be three scans for the same rows.
  const [posts, accounts, lifetime] = await Promise.all([
    prisma.post.findMany({
      where: { postedAt: { gte: oldest }, ...IN_ROTATION },
      select: { redditAccountId: true, postedAt: true, status: true, removedBy: true },
    }),
    prisma.redditAccount.findMany({
      where: ROTATION_ACCOUNT,
      select: { id: true, username: true, status: true, lastPostAt: true },
      orderBy: { username: 'asc' },
    }),
    prisma.post.groupBy({ by: ['redditAccountId'], where: IN_ROTATION, _count: { _all: true } }),
  ])

  const lifetimeById = new Map(lifetime.map((g) => [g.redditAccountId, g._count._all]))
  const rows = new Map<string, AccountVolume>()
  for (const a of accounts) {
    rows.set(a.id, {
      accountId: a.id,
      username: a.username,
      status: a.status,
      lastPostAt: a.lastPostAt,
      lifetime: lifetimeById.get(a.id) ?? 0,
      windows: { '24h': EMPTY(), '7d': EMPTY(), '30d': EMPTY() },
    })
  }

  const total: Record<Window, VolumeCell> = { '24h': EMPTY(), '7d': EMPTY(), '30d': EMPTY() }

  for (const p of posts) {
    const row = rows.get(p.redditAccountId)
    const ageH = (now.getTime() - p.postedAt.getTime()) / 3_600_000
    for (const w of ['24h', '7d', '30d'] as Window[]) {
      if (ageH > WINDOW_HOURS[w]) continue
      for (const cell of [row?.windows[w], total[w]]) {
        if (!cell) continue
        cell.posted += 1
        if (p.status === 'LIVE') cell.live += 1
        else if (p.removedBy) cell[BUCKET[p.removedBy]] += 1
        else cell.unknown += 1
      }
    }
  }

  const list = [...rows.values()]
  return {
    total,
    // Accounts that posted in the last 30 days lead; the rest are ordered by
    // lifetime so an account with history but no recent work is still findable.
    accounts: list.sort(
      (a, b) =>
        b.windows['30d'].posted - a.windows['30d'].posted ||
        b.lifetime - a.lifetime ||
        a.username.localeCompare(b.username),
    ),
    activeInWindow: list.filter((a) => a.windows['30d'].posted > 0).length,
    accountsTotal: list.length,
  }
}
