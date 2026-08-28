import { prisma } from '@/lib/prisma'

/**
 * Turn a subreddit list into a day's posting order for one account.
 *
 * The rule, in three parts:
 *
 *  1. The list is longer than the day. 30 subreddits, 15 slots — something has
 *     to be left out, and it must not be the same thing every day.
 *  2. The best subreddits go out EVERY day, the middle most days, the weakest
 *     rotate in occasionally. Nothing is dropped permanently.
 *  3. Within the day the order runs weakest to strongest, so the best subreddit
 *     is the last post. An account stopped mid-run loses its worst slots, not
 *     its best one.
 *
 * "Best" is whatever the strategy ranks on — that is the ONLY difference
 * between the three. Selection and ordering are identical.
 */
export type Strategy = 'members' | 'ourResults' | 'traffic'

export interface Candidate {
  name: string
  subscribers: number | null
  postsPerDay: number | null
  /** median upvotes WE have got there */
  ourMedian: number | null
  ourPosts: number
  /** null when this account has never posted there */
  lastUsedAt: Date | null
}

export interface Slot {
  position: number
  subreddit: string
  /** what the strategy ranked it on, so a plan can be argued with */
  rank: number
  tier: 'A' | 'B' | 'C'
  daysSinceUsed: number | null
}

/** Higher is better in all three strategies. */
function score(c: Candidate, strategy: Strategy): number {
  if (strategy === 'members') return c.subscribers ?? 0
  if (strategy === 'ourResults') {
    // An untested subreddit is not worst, it is unknown. A list that only
    // reuses proven subs never finds a better one, so unknowns are lifted to
    // the median below and keep getting sampled.
    return c.ourPosts >= 2 ? (c.ourMedian ?? 0) : -1
  }
  // traffic: reach against competition. 2M members taking 300 posts a day
  // buries you by lunchtime; 150k taking 40 keeps you up overnight.
  const subs = c.subscribers ?? 0
  const rate = c.postsPerDay ?? 0
  if (!subs) return 0
  return rate > 0 ? Math.round(subs / rate) : subs
}

export function planDay(
  candidates: Candidate[],
  slots: number,
  strategy: Strategy,
  now = new Date(),
): Slot[] {
  if (!candidates.length || slots <= 0) return []

  const scored = candidates.map((c) => ({
    c,
    s: score(c, strategy),
    days: c.lastUsedAt ? (now.getTime() - c.lastUsedAt.getTime()) / 86_400_000 : null,
  }))

  const known = scored
    .filter((r) => r.s >= 0)
    .map((r) => r.s)
    .sort((a, b) => a - b)
  const median = known.length ? known[Math.floor(known.length / 2)] : 0
  for (const r of scored) if (r.s < 0) r.s = median

  scored.sort((a, b) => b.s - a.s)

  // Tier sizes come from the SLOTS, not from thirds of the list. With 112
  // subreddits and 15 slots a third-of-the-list tier A holds 37 entries, so
  // every slot is drawn from A and the middle and bottom never appear at all —
  // which is exactly the behaviour the rule exists to prevent.
  //
  // Instead: a fixed head that goes out EVERY day, and the rest of the slots
  // rotated through everything below it, best tier first. With 20 subs and 15
  // slots the top 6 are daily and the other 9 slots cycle the remaining 14, so
  // the middle comes up roughly twice as often as the bottom.
  const headSize = Math.min(scored.length, Math.max(1, Math.round(slots * 0.4)))
  const head = scored.slice(0, headSize)
  const tail = scored.slice(headSize)

  // The tail splits in two so the middle genuinely outranks the bottom for
  // draw order, rather than relying on staleness alone.
  const midEnd = Math.ceil(tail.length / 2)
  const pool = [
    ...head.map((r) => ({ ...r, tier: 'A' as const })),
    ...tail.slice(0, midEnd).map((r) => ({ ...r, tier: 'B' as const })),
    ...tail.slice(midEnd).map((r) => ({ ...r, tier: 'C' as const })),
  ]

  // Longest-unused first inside a tier: nothing repeats until every member of
  // that tier has had a turn.
  const staleFirst = (x: (typeof pool)[number], y: (typeof pool)[number]) => {
    const dx = x.days ?? Number.POSITIVE_INFINITY
    const dy = y.days ?? Number.POSITIVE_INFINITY
    if (dx !== dy) return dy - dx
    return y.s - x.s
  }

  const picked: typeof pool = []
  // The head is unconditional — it is the "always appears" part of the rule.
  for (const p of pool.filter((q) => q.tier === 'A')) {
    if (picked.length >= slots) break
    picked.push(p)
  }
  // The rest of the slots are split 2:1 between middle and bottom. Without a
  // reserved share the bottom never appears at all — with 112 subreddits the
  // middle tier alone holds 53 and would swallow every remaining slot for six
  // days running. "Medium more often than the smallest" only means something if
  // the smallest gets a share at all.
  const rest = slots - picked.length
  const quota = { B: Math.ceil((rest * 2) / 3), C: rest - Math.ceil((rest * 2) / 3) }
  for (const tier of ['B', 'C'] as const) {
    let taken = 0
    for (const p of pool.filter((q) => q.tier === tier).sort(staleFirst)) {
      if (picked.length >= slots || taken >= quota[tier]) break
      picked.push(p)
      taken += 1
    }
  }
  // Anything still short — a tier ran out — is topped up from whatever is left.
  if (picked.length < slots) {
    const have = new Set(picked.map((p) => p.c.name))
    for (const p of pool.filter((q) => !have.has(q.c.name)).sort(staleFirst)) {
      if (picked.length >= slots) break
      picked.push(p)
    }
  }

  picked.sort((a, b) => a.s - b.s)

  return picked.map((p, i) => ({
    position: i + 1,
    subreddit: p.c.name,
    rank: Math.round(p.s),
    tier: p.tier,
    daysSinceUsed: p.days === null ? null : Math.round(p.days * 10) / 10,
  }))
}

/**
 * Everything the planner needs about one list, for one account.
 *
 * Requirement filtering happens here, not in `planDay`: a subreddit the account
 * cannot post in is not a low-ranked option, it is not an option at all.
 */
export async function candidatesFor(opts: {
  nicheName: string
  redditAccountId: string
  now?: Date
}): Promise<{ candidates: Candidate[]; excluded: Array<{ name: string; why: string }> }> {
  const now = opts.now ?? new Date()
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)

  const [account, items, usedToday, history, subs] = await Promise.all([
    prisma.redditAccount.findUniqueOrThrow({
      where: { id: opts.redditAccountId },
      select: {
        karmaPost: true,
        karmaComment: true,
        redditCreatedAt: true,
        verifiedSubreddits: true,
      },
    }),
    prisma.subredditNicheItem.findMany({
      where: { niche: { name: opts.nicheName } },
      select: { subreddit: true, discovered: true },
    }),
    prisma.post.findMany({
      where: { redditAccountId: opts.redditAccountId, postedAt: { gte: dayStart } },
      select: { subreddit: { select: { name: true } } },
    }),
    prisma.post.groupBy({
      by: ['subredditId'],
      where: { redditAccountId: opts.redditAccountId },
      _max: { postedAt: true },
    }),
    prisma.subreddit.findMany({
      select: { id: true, name: true, posts: { select: { latestUpvotes: true, status: true } } },
    }),
  ])

  const usedNames = new Set(
    usedToday.map((p) => p.subreddit?.name?.toLowerCase()).filter(Boolean) as string[],
  )
  const karma = account.karmaPost + account.karmaComment
  const ageDays = account.redditCreatedAt
    ? Math.floor((now.getTime() - account.redditCreatedAt.getTime()) / 86_400_000)
    : 0
  const verified = new Set(account.verifiedSubreddits.map((v) => v.toLowerCase()))
  const byName = new Map(subs.map((s) => [s.name.toLowerCase(), s]))
  const lastBySubId = new Map(history.map((h) => [h.subredditId, h._max.postedAt]))

  const candidates: Candidate[] = []
  const excluded: Array<{ name: string; why: string }> = []

  for (const it of items) {
    const d = it.discovered
    const name = it.subreddit
    if (!d || d.unavailable) {
      excluded.push({ name, why: 'subreddit is gone' })
      continue
    }
    if (d.dismissed) {
      excluded.push({ name, why: 'dismissed' })
      continue
    }
    if (usedNames.has(name.toLowerCase())) {
      excluded.push({ name, why: 'already posted there today' })
      continue
    }
    if (d.minKarma != null && karma < d.minKarma) {
      excluded.push({ name, why: `needs ${d.minKarma} karma, has ${karma}` })
      continue
    }
    if (d.minAccountAgeDays != null && ageDays < d.minAccountAgeDays) {
      excluded.push({ name, why: `needs ${d.minAccountAgeDays}d age, is ${ageDays}d` })
      continue
    }
    if (d.requiresVerification === true && !verified.has(name.toLowerCase())) {
      excluded.push({ name, why: 'needs verification' })
      continue
    }

    const own = byName.get(name.toLowerCase())
    const scores = (own?.posts ?? [])
      .filter((p) => p.status === 'LIVE')
      .map((p) => p.latestUpvotes ?? 0)
      .sort((a, b) => a - b)

    candidates.push({
      name,
      subscribers: d.subscribers,
      postsPerDay: d.postsPerDay,
      ourMedian: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      ourPosts: scores.length,
      lastUsedAt: own ? (lastBySubId.get(own.id) ?? null) : null,
    })
  }

  return { candidates, excluded }
}
