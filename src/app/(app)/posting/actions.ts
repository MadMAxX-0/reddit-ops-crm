'use server'

import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { planDay, type Candidate, type Strategy } from '@/lib/posting/order'

/**
 * Build a day's posting order from a pasted list.
 *
 * The list arrives fresh each time rather than being stored, because that is
 * how the work actually happens — a manager decides today's set and hands it
 * over. Anything we already know about a subreddit (size, traffic, what we have
 * got there before) is joined on; anything we have never seen still gets a
 * place in the order rather than being silently dropped.
 */
export interface PlanSlot {
  position: number
  subreddit: string
  note: string
  /** what the strategy scored it — kept so a swapped-in row can be re-sorted */
  rank: number
  subscribers: number | null
  /** true = adult only, false = clothed posts allowed too, null = not read */
  nsfw: boolean | null
  sfwOk: boolean
  /** the demands worth seeing before posting, shortest first */
  rules: string[]
}

export interface PlanResult {
  ok: true
  slots: PlanSlot[]
  /**
   * Everything the strategy ranked but did not pick, best first. The plan is a
   * suggestion, not an instruction — whoever is posting knows things the data
   * does not, so the rest of the pool travels with it and a swap costs one
   * click rather than a rebuild.
   */
  alternatives: PlanSlot[]
  skipped: Array<{ name: string; why: string }>
  unmeasured: number
}

export async function buildPlan(input: {
  /** a saved list, or pasted names — one of the two */
  nicheId?: string
  raw?: string
  accountId: string
  slots: number
  strategy: Strategy
}): Promise<PlanResult | { ok: false; error: string }> {
  const ctx = await requireCtx()
  if (!ctx.user) return { ok: false, error: 'Not signed in.' }

  // A saved list is the normal case; pasting is for a one-off.
  const raw = input.nicheId
    ? (
        await prisma.subredditNicheItem.findMany({
          where: { nicheId: input.nicheId },
          select: { subreddit: true },
        })
      )
        .map((i) => i.subreddit)
        .join(' ')
    : (input.raw ?? '')

  const names = [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((s) =>
          s
            .trim()
            .replace(/^\/?r\//i, '')
            .replace(/\/$/, ''),
        )
        .filter((s) => /^[A-Za-z0-9_]{2,21}$/.test(s)),
    ),
  ]
  if (!names.length) return { ok: false, error: 'That list is empty.' }

  const account = await prisma.redditAccount.findUnique({
    where: { id: input.accountId },
    select: {
      username: true,
      karmaPost: true,
      karmaComment: true,
      redditCreatedAt: true,
      verifiedSubreddits: true,
    },
  })
  if (!account) return { ok: false, error: 'Account not found.' }

  const now = new Date()
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)

  const [known, ourSubs, usedToday] = await Promise.all([
    prisma.discoveredSubreddit.findMany({
      where: { name: { in: names, mode: 'insensitive' } },
    }),
    prisma.subreddit.findMany({
      where: { name: { in: names, mode: 'insensitive' } },
      select: {
        name: true,
        posts: {
          where: { redditAccount: { username: account.username } },
          select: { latestUpvotes: true, status: true, postedAt: true },
        },
      },
    }),
    prisma.post.findMany({
      where: { redditAccount: { username: account.username }, postedAt: { gte: dayStart } },
      select: { subreddit: { select: { name: true } } },
    }),
  ])

  const lower = (s: string) => s.toLowerCase()
  const knownBy = new Map(known.map((k) => [lower(k.name), k]))
  const oursBy = new Map(ourSubs.map((s) => [lower(s.name), s]))
  const usedNames = new Set(
    usedToday.map((p) => p.subreddit?.name && lower(p.subreddit.name)).filter(Boolean) as string[],
  )

  const karma = account.karmaPost + account.karmaComment
  const ageDays = account.redditCreatedAt
    ? Math.floor((now.getTime() - account.redditCreatedAt.getTime()) / 86_400_000)
    : 0
  const verified = new Set(account.verifiedSubreddits.map(lower))

  const candidates: Candidate[] = []
  const skipped: Array<{ name: string; why: string }> = []
  let unmeasured = 0

  for (const name of names) {
    const d = knownBy.get(lower(name))

    if (d?.unavailable) {
      skipped.push({ name, why: 'gone from Reddit' })
      continue
    }
    if (usedNames.has(lower(name))) {
      skipped.push({ name, why: 'already posted there today' })
      continue
    }
    if (d?.minKarma != null && karma < d.minKarma) {
      skipped.push({ name, why: `needs ${d.minKarma} karma` })
      continue
    }
    if (d?.minAccountAgeDays != null && ageDays < d.minAccountAgeDays) {
      skipped.push({ name, why: `needs ${d.minAccountAgeDays} days age` })
      continue
    }
    if (d?.requiresVerification === true && !verified.has(lower(name))) {
      skipped.push({ name, why: 'needs verification' })
      continue
    }
    if (!d) unmeasured += 1

    const mine = (oursBy.get(lower(name))?.posts ?? []).filter((p) => p.status === 'LIVE')
    const scores = mine.map((p) => p.latestUpvotes ?? 0).sort((a, b) => a - b)
    const last = mine.reduce<Date | null>((a, p) => (!a || p.postedAt > a ? p.postedAt : a), null)

    candidates.push({
      name: d?.name ?? name,
      subscribers: d?.subscribers ?? null,
      postsPerDay: d?.postsPerDay ?? null,
      ourMedian: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      ourPosts: scores.length,
      lastUsedAt: last,
    })
  }

  const wanted = Math.max(1, Math.min(50, input.slots))
  const plan = planDay(candidates, wanted, input.strategy, now)

  // One short line of why a subreddit is here, in the terms the strategy used.
  const noteFor = (c: Candidate) =>
    input.strategy === 'ourResults'
      ? c.ourPosts
        ? `${c.ourMedian}↑ from ${c.ourPosts} posts`
        : 'never tried'
      : input.strategy === 'traffic'
        ? c.postsPerDay
          ? `${fmt(c.subscribers)} · ${c.postsPerDay}/day`
          : `${fmt(c.subscribers)} · traffic unknown`
        : fmt(c.subscribers)

  // The chips a poster actually needs at the moment of posting: what the sub
  // demands, in the order that gets someone banned fastest if ignored.
  const rulesFor = (name: string): string[] => {
    const d = knownBy.get(lower(name))
    if (!d) return []
    const out: string[] = []
    if (d.requiresVerification === true) out.push('verification')
    if (d.minKarma != null) out.push(`min ${d.minKarma} karma`)
    if (d.minAccountAgeDays != null) out.push(`${d.minAccountAgeDays}d account age`)
    if (d.originalContentOnly === true) out.push('original content only')
    if (d.bansAskingForUpvotes === true) out.push('no clickbait / vote begging')
    if (d.allowsVideos === false) out.push('no native video')
    if (d.submissionType === 'link') out.push('link posts only')
    if (d.submissionType === 'self') out.push('text posts only')
    return out
  }

  const chosen = new Set(plan.map((p) => p.subreddit))
  // The rest of the pool, ranked the same way, so a swap keeps the order honest.
  const rest = planDay(
    candidates.filter((c) => !chosen.has(c.name)),
    candidates.length,
    input.strategy,
    now,
  )

  return {
    ok: true,
    unmeasured,
    skipped,
    slots: plan.map((p) => shape(p.position, p.subreddit, p.rank)),
    alternatives: rest.map((p) => shape(0, p.subreddit, p.rank)).sort((a, b) => b.rank - a.rank),
  }

  function shape(position: number, name: string, rank: number): PlanSlot {
    const d = knownBy.get(lower(name))
    return {
      position,
      subreddit: name,
      rank,
      note: noteFor(candidates.find((x) => x.name === name)!),
      subscribers: d?.subscribers ?? null,
      nsfw: d ? d.over18 : null,
      // "SFW ok" is a real distinction on these lists — it is where a clothed
      // teaser can go, and it is stored on the item note by the importer.
      sfwOk: Boolean(d?.description && /sfw/i.test(d.description)),
      rules: rulesFor(name),
    }
  }
}

function fmt(n: number | null): string {
  if (!n) return 'size unknown'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
