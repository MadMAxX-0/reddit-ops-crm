import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { dayBounds, dayKeysInRange, todayKey, type DayKey } from '@/lib/time'

/**
 * The daily grid: poster → account × day.
 *
 * This is the screen the operation actually runs on. One row per Reddit
 * account, one column per day, and a cell that says whether that account posted
 * that day. Every cell comes from a discovered post — there is no way to mark a
 * day by hand, which is the whole point.
 */

export type CellState =
  | 'posted' // at least one post discovered that day
  | 'none' // account was in rotation, nothing found
  | 'inactive' // account not in rotation that day (suspended, unassigned, retired)
  | 'future' // day has not happened yet in the workspace timezone

export interface GridCell {
  day: DayKey
  state: CellState
  posts: number
  removed: number
}

export interface GridRow {
  accountId: string
  username: string
  /** verbatim label the team uses, e.g. "ZoeMain" */
  modelLabel: string
  creatorName: string | null
  status: string
  karmaPost: number
  ageDays: number | null
  lastPostAt: Date | null
  cells: GridCell[]
  posts: number
  removed: number
}

export interface GridSection {
  posterId: string
  posterName: string
  rows: GridRow[]
  posts: number
  removed: number
  activeAccounts: number
}

export interface GridResult {
  days: DayKey[]
  sections: GridSection[]
  unassigned: GridRow[]
  totals: { posts: number; removed: number; accounts: number; postingAccounts: number }
}

export async function buildGrid(
  boundaryTz: string,
  days = 14,
  endKey?: DayKey,
): Promise<GridResult> {
  const lastDay = endKey ?? todayKey(boundaryTz)
  const { end } = dayBounds(lastDay, boundaryTz)
  const start = new Date(end.getTime() - days * 86_400_000)
  const dayKeys = dayKeysInRange({ start, end }, boundaryTz)
  const todayK = todayKey(boundaryTz)

  const tz = /^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(boundaryTz) ? boundaryTz : 'UTC'

  const [accounts, buckets] = await Promise.all([
    prisma.redditAccount.findMany({
      where: { status: { not: 'RETIRED' } },
      orderBy: [{ username: 'asc' }],
      select: {
        id: true,
        username: true,
        modelLabel: true,
        status: true,
        karmaPost: true,
        redditCreatedAt: true,
        lastPostAt: true,
        suspendedAt: true,
        assignedPoster: { select: { id: true, name: true } },
        assignedCreator: { select: { stageName: true } },
      },
    }),
    // one row per account per day — grouping in SQL keeps this a single query
    // no matter how many accounts are in rotation
    prisma.$queryRaw<Array<{ account_id: string; day: string; posts: bigint; removed: bigint }>>(
      Prisma.sql`
        SELECT "redditAccountId" AS account_id,
               to_char(("postedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${Prisma.raw(`'${tz}'`)}), 'YYYY-MM-DD') AS day,
               COUNT(*) AS posts,
               COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed
        FROM "Post"
        WHERE "postedAt" >= ${start} AND "postedAt" < ${end}
        GROUP BY 1, 2
      `,
    ),
  ])

  const byAccountDay = new Map<string, { posts: number; removed: number }>()
  for (const b of buckets) {
    byAccountDay.set(`${b.account_id}:${b.day}`, {
      posts: Number(b.posts),
      removed: Number(b.removed),
    })
  }

  const now = Date.now()
  const toRow = (a: (typeof accounts)[number]): GridRow => {
    const inRotation = a.status === 'ACTIVE' || a.status === 'READY'
    let posts = 0
    let removed = 0

    const cells: GridCell[] = dayKeys.map((day) => {
      const hit = byAccountDay.get(`${a.id}:${day}`)
      posts += hit?.posts ?? 0
      removed += hit?.removed ?? 0

      if (day > todayK) return { day, state: 'future', posts: 0, removed: 0 }
      if (hit?.posts) return { day, state: 'posted', posts: hit.posts, removed: hit.removed }
      // A suspended account is only "inactive" from the day it was suspended;
      // before that it was working, and blanking its whole row would hide the
      // fact that it used to produce.
      const suspendedBefore = a.suspendedAt && day >= a.suspendedAt.toISOString().slice(0, 10)
      if (!inRotation || suspendedBefore) return { day, state: 'inactive', posts: 0, removed: 0 }
      return { day, state: 'none', posts: 0, removed: 0 }
    })

    return {
      accountId: a.id,
      username: a.username,
      modelLabel: a.modelLabel ?? a.assignedCreator?.stageName ?? '—',
      creatorName: a.assignedCreator?.stageName ?? null,
      status: a.status,
      karmaPost: a.karmaPost,
      ageDays: a.redditCreatedAt
        ? Math.floor((now - a.redditCreatedAt.getTime()) / 86_400_000)
        : null,
      lastPostAt: a.lastPostAt,
      cells,
      posts,
      removed,
    }
  }

  const sections = new Map<string, GridSection>()
  const unassigned: GridRow[] = []

  for (const a of accounts) {
    const row = toRow(a)
    const poster = a.assignedPoster
    if (!poster) {
      unassigned.push(row)
      continue
    }
    const section = sections.get(poster.id) ?? {
      posterId: poster.id,
      posterName: poster.name,
      rows: [],
      posts: 0,
      removed: 0,
      activeAccounts: 0,
    }
    section.rows.push(row)
    section.posts += row.posts
    section.removed += row.removed
    if (row.posts > 0) section.activeAccounts += 1
    sections.set(poster.id, section)
  }

  const ordered = [...sections.values()].sort((a, b) => a.posterName.localeCompare(b.posterName))

  return {
    days: dayKeys,
    sections: ordered,
    unassigned,
    totals: {
      posts: ordered.reduce((s, x) => s + x.posts, 0) + unassigned.reduce((s, x) => s + x.posts, 0),
      removed: ordered.reduce((s, x) => s + x.removed, 0),
      accounts: accounts.length,
      postingAccounts: ordered.reduce((s, x) => s + x.activeAccounts, 0),
    },
  }
}
