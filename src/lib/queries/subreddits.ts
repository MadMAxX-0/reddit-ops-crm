import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ResolvedRange } from '@/lib/time'
import { conversionsByPostCte } from './attribution-sql'

export interface SubredditRow {
  id: string
  name: string
  subscribers: number
  isNsfw: boolean
  verificationRequired: boolean
  minKarma: number
  minAccountAgeDays: number
  postCooldownHours: number
  allowedFlairs: string[]
  rulesSummary: string | null
  tier: string
  tierIsManual: boolean
  suggestedTier: string
  status: string
  lastScrapedAt: Date | null
  posts: number
  removed: number
  removalRate: number | null
  medianUpvotes: number | null
  landings: number
  /** landings per upvote — a proxy for reach, and labelled as one */
  ctrProxy: number | null
  conversions: number
  convRate: number | null
  revenueCents: number
  revenuePerPostCents: number | null
}

/**
 * Tier suggestion from a blend of conversion rate and removal rate.
 *
 * Reach is deliberately not in the blend: a two-million-subscriber sub that
 * removes 40% of what you send and converts nothing is not an S-tier, it is a
 * time sink with a big number next to it.
 */
export function suggestTier(input: {
  posts: number
  convRate: number | null
  removalRate: number | null
  revenuePerPostCents: number | null
}): string {
  // not enough evidence to grade — say so rather than guessing
  if (input.posts < 8) return '—'
  const conv = input.convRate ?? 0
  const removal = input.removalRate ?? 0
  const rpp = (input.revenuePerPostCents ?? 0) / 100

  const score = conv * 1000 + rpp * 2 - removal * 220
  if (score >= 55) return 'S'
  if (score >= 28) return 'A'
  if (score >= 10) return 'B'
  return 'C'
}

export async function listSubreddits(
  range: ResolvedRange,
  attributionWindowH = 72,
): Promise<SubredditRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      name: string
      subscribers: number
      isNsfw: boolean
      verificationRequired: boolean
      minKarma: number
      minAccountAgeDays: number
      postCooldownHours: number
      allowedFlairs: string[]
      rulesSummary: string | null
      tier: string
      tierIsManual: boolean
      status: string
      lastScrapedAt: Date | null
      posts: bigint
      removed: bigint
      median_upvotes: number | null
      total_upvotes: bigint
      landings: bigint
      conversions: bigint
      revenue_cents: bigint
    }>
  >(Prisma.sql`
    WITH p AS (
      SELECT "subredditId",
             COUNT(*) AS posts,
             COUNT(*) FILTER (WHERE status = 'REMOVED') AS removed,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latestUpvotes") AS median_upvotes,
             COALESCE(SUM("latestUpvotes"), 0) AS total_upvotes
      FROM "Post"
      WHERE "postedAt" >= ${range.start} AND "postedAt" < ${range.end}
      GROUP BY 1
    ),
    f AS (
      SELECT po."subredditId",
             COUNT(*) FILTER (WHERE fe.type = 'LANDED' AND NOT fe."isBot") AS landings
      FROM "FunnelEvent" fe
      JOIN "Post" po ON po.id = fe."attributedPostId"
      WHERE fe.ts >= ${range.start} AND fe.ts < ${range.end}
      GROUP BY 1
    ),
    c AS (
      ${conversionsByPostCte(range.start, range.end, attributionWindowH, 'subredditId')}
    )
    SELECT s.id, s.name, s.subscribers, s."isNsfw", s."verificationRequired",
           s."minKarma", s."minAccountAgeDays", s."postCooldownHours", s."allowedFlairs",
           s."rulesSummary", s.tier::text AS tier, s."tierIsManual", s.status::text AS status,
           s."lastScrapedAt",
           COALESCE(p.posts, 0) AS posts,
           COALESCE(p.removed, 0) AS removed,
           p.median_upvotes,
           COALESCE(p.total_upvotes, 0) AS total_upvotes,
           COALESCE(f.landings, 0) AS landings,
           COALESCE(c.conversions, 0) AS conversions,
           COALESCE(c.revenue_cents, 0) AS revenue_cents
    FROM "Subreddit" s
    LEFT JOIN p ON p."subredditId" = s.id
    LEFT JOIN f ON f."subredditId" = s.id
    LEFT JOIN c ON c.group_id = s.id
    ORDER BY COALESCE(c.revenue_cents, 0) DESC, s.subscribers DESC
  `)

  return rows.map((r) => {
    const posts = Number(r.posts)
    const removed = Number(r.removed)
    const landings = Number(r.landings)
    const conversions = Number(r.conversions)
    const revenueCents = Number(r.revenue_cents)
    const totalUpvotes = Number(r.total_upvotes)
    const removalRate = posts ? removed / posts : null
    const convRate = landings ? conversions / landings : null
    const revenuePerPostCents = posts ? Math.round(revenueCents / posts) : null

    return {
      id: r.id,
      name: r.name,
      subscribers: r.subscribers,
      isNsfw: r.isNsfw,
      verificationRequired: r.verificationRequired,
      minKarma: r.minKarma,
      minAccountAgeDays: r.minAccountAgeDays,
      postCooldownHours: r.postCooldownHours,
      allowedFlairs: r.allowedFlairs,
      rulesSummary: r.rulesSummary,
      tier: r.tier,
      tierIsManual: r.tierIsManual,
      suggestedTier: suggestTier({ posts, convRate, removalRate, revenuePerPostCents }),
      status: r.status,
      lastScrapedAt: r.lastScrapedAt,
      posts,
      removed,
      removalRate,
      medianUpvotes: r.median_upvotes == null ? null : Math.round(Number(r.median_upvotes)),
      landings,
      ctrProxy: totalUpvotes ? landings / totalUpvotes : null,
      conversions,
      convRate,
      revenueCents,
      revenuePerPostCents,
    }
  })
}
