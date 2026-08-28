import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { dayBounds, todayKey, type DayKey } from '@/lib/time'

/**
 * What each VA has to show for themselves, derived from the accounts.
 *
 * Nothing here is logged by hand. An account records who made it, who is
 * warming it and when, and Reddit supplies its age and karma, so the numbers
 * are true whether or not anybody fills in a form — which is the point, because
 * nobody ever does.
 *
 * The two jobs are measured on different clocks. Creation is piece work counted
 * by the day and paid per account. Farming is counted by the month, because an
 * account takes weeks to warm and a daily target for it would only ever measure
 * impatience.
 */

export interface CreationVaRow {
  rank: number
  userId: string
  name: string
  madeToday: number
  madeAllTime: number
  goal: number
  payRateCents: number
  payTodayCents: number
  flagged: number
  firstAt: Date | null
  lastAt: Date | null
}

export interface FarmingVaRow {
  rank: number
  userId: string
  name: string
  /** accounts of theirs that reached the poster this month */
  promotedThisMonth: number
  monthlyGoal: number
  /** what they are holding right now */
  farming: number
  ready: number
  flagged: number
  karma: number
  medianAgeDays: number | null
}

export async function creationTracking(
  boundaryTz: string,
  key: DayKey = todayKey(boundaryTz),
): Promise<CreationVaRow[]> {
  const { start, end } = dayBounds(key, boundaryTz)

  const users = await prisma.user.findMany({
    where: { role: 'FARMER', status: 'ACTIVE', payPerAccountCents: { gt: 0 } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, dailyAccountGoal: true, payPerAccountCents: true },
  })
  if (!users.length) return []

  const accounts = await prisma.redditAccount.findMany({
    where: { createdById: { in: users.map((u) => u.id) } },
    select: { createdById: true, createdAt: true, flag: true, shadowbanned: true },
  })

  const rows = users.map((u) => {
    const mine = accounts.filter((a) => a.createdById === u.id)
    const today = mine.filter((a) => a.createdAt >= start && a.createdAt < end)
    const times = today.map((a) => a.createdAt).sort((a, b) => a.getTime() - b.getTime())
    return {
      rank: 0,
      userId: u.id,
      name: u.name,
      madeToday: today.length,
      madeAllTime: mine.length,
      goal: u.dailyAccountGoal,
      payRateCents: u.payPerAccountCents,
      payTodayCents: today.length * u.payPerAccountCents,
      flagged: mine.filter((a) => a.flag !== 'NONE' || a.shadowbanned).length,
      firstAt: times[0] ?? null,
      lastAt: times[times.length - 1] ?? null,
    }
  })
  rows.sort((a, b) => b.madeToday - a.madeToday || b.madeAllTime - a.madeAllTime)
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

export async function farmingTracking(
  monthStart: Date,
  monthEnd: Date,
  readyAgeDays = 21,
): Promise<FarmingVaRow[]> {
  const users = await prisma.user.findMany({
    where: { role: 'FARMER', status: 'ACTIVE', monthlyAccountGoal: { gt: 0 } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, monthlyAccountGoal: true },
  })
  if (!users.length) return []

  const accounts = await prisma.redditAccount.findMany({
    where: { farmedById: { in: users.map((u) => u.id) } },
    select: {
      farmedById: true,
      pipelineStage: true,
      flag: true,
      shadowbanned: true,
      karmaPost: true,
      karmaComment: true,
      redditCreatedAt: true,
      updatedAt: true,
    },
  })

  const now = Date.now()
  const rows = users.map((u) => {
    const mine = accounts.filter((a) => a.farmedById === u.id)
    const farming = mine.filter((a) => a.pipelineStage === 'FARMING')
    const ages = farming
      .map((a) => (a.redditCreatedAt ? (now - a.redditCreatedAt.getTime()) / 86_400_000 : null))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b)
    return {
      rank: 0,
      userId: u.id,
      name: u.name,
      // an account counts once it has reached a poster, which is the point of
      // warming one — not when someone declares it finished
      promotedThisMonth: mine.filter(
        (a) => a.pipelineStage === 'ACTIVE' && a.updatedAt >= monthStart && a.updatedAt < monthEnd,
      ).length,
      monthlyGoal: u.monthlyAccountGoal,
      farming: farming.length,
      ready: farming.filter(
        (a) =>
          a.flag === 'NONE' &&
          a.redditCreatedAt != null &&
          (now - a.redditCreatedAt.getTime()) / 86_400_000 >= readyAgeDays,
      ).length,
      flagged: mine.filter((a) => a.flag !== 'NONE' || a.shadowbanned).length,
      karma: mine.reduce((s, a) => s + a.karmaPost + a.karmaComment, 0),
      medianAgeDays: ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null,
    }
  })
  rows.sort((a, b) => b.promotedThisMonth - a.promotedThisMonth || b.farming - a.farming)
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

export interface PipelineSummary {
  accounts: number
  /** of those, the ones not suspended or retired */
  alive: number
  /** every status actually present, biggest first — never a guessed category */
  byStatus: { status: string; n: number }[]
  ready: number
  readyAgeDays: number
  readyKarma: number
  karma: number
  bannedRecently: number
  /** the earliest ban *detection* behind that count, so the figure can be read honestly */
  banWindowDays: number
  /** how many suspensions have no date at all — they predate the health job */
  bansUndated: number
}

/**
 * The four numbers that describe the account supply at a glance.
 *
 * "Ready" is age AND karma together, because either alone lies: a three-week-old
 * account with 4 karma has been sitting untouched, and a 1,200-karma account
 * made yesterday is a burn risk whatever its score says.
 *
 * The ban count is deliberately named for what it measures — accounts FOUND
 * suspended in the window, not accounts banned in it. Reddit does not say when
 * it banned anyone, so the only date available is when the health job noticed,
 * and the first run of that job discovers every historic ban at once. Calling
 * that "13 bans on Sunday" would be an invention.
 */
export async function pipelineSummary(
  readyAgeDays = 14,
  readyKarma = 1000,
  banWindowDays = 7,
): Promise<PipelineSummary> {
  const ageCutoff = new Date(Date.now() - readyAgeDays * 86_400_000)
  const banCutoff = new Date(Date.now() - banWindowDays * 86_400_000)

  const statuses = await prisma.redditAccount.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { _count: { status: 'desc' } },
  })

  const rows = await prisma.$queryRaw<
    Array<{
      accounts: bigint
      alive: bigint
      ready: bigint
      karma: bigint
      banned: bigint
      undated: bigint
    }>
  >(Prisma.sql`
    SELECT COUNT(*) AS accounts,
           COUNT(*) FILTER (WHERE status NOT IN ('SUSPENDED', 'RETIRED')) AS alive,
           COUNT(*) FILTER (
             WHERE status NOT IN ('SUSPENDED', 'RETIRED')
               AND ("karmaPost" + "karmaComment") >= ${readyKarma}
               AND COALESCE("redditCreatedAt", "createdAt") <= ${ageCutoff}
           ) AS ready,
           COALESCE(SUM("karmaPost" + "karmaComment"), 0) AS karma,
           COUNT(*) FILTER (WHERE status = 'SUSPENDED' AND "suspendedAt" >= ${banCutoff}) AS banned,
           COUNT(*) FILTER (WHERE status = 'SUSPENDED' AND "suspendedAt" IS NULL) AS undated
    FROM "RedditAccount"
  `)

  const r = rows[0]
  return {
    accounts: Number(r?.accounts ?? 0),
    alive: Number(r?.alive ?? 0),
    byStatus: statuses.map((x) => ({ status: String(x.status), n: x._count._all })),
    ready: Number(r?.ready ?? 0),
    readyAgeDays,
    readyKarma,
    karma: Number(r?.karma ?? 0),
    bannedRecently: Number(r?.banned ?? 0),
    banWindowDays,
    bansUndated: Number(r?.undated ?? 0),
  }
}
