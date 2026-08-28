import { NextRequest } from 'next/server'
import { requireCtx } from '@/lib/session'
import { listAccounts } from '@/lib/queries/accounts'
import { csvResponse, toCsv } from '@/lib/csv'
import { fmtPct } from '@/lib/format'

const MAX_ROWS = 20_000

function list(sp: URLSearchParams, key: string) {
  return sp
    .getAll(key)
    .flatMap((s) => s.split(','))
    .filter(Boolean)
}

export async function GET(req: NextRequest) {
  const ctx = await requireCtx()
  const sp = req.nextUrl.searchParams

  // Export honours the exact filters on screen, including the role scope, so
  // "export" can never hand a VA rows they cannot see in the table.
  const { data } = await listAccounts(ctx, {
    status: list(sp, 'status'),
    health: sp.get('health') ?? undefined,
    karma: sp.get('karma') ?? undefined,
    verified: sp.get('verified') ?? undefined,
    assigned: sp.get('assigned') ?? undefined,
    creatorIds: list(sp, 'creator'),
    posterIds: list(sp, 'poster'),
    farmerIds: list(sp, 'farmer'),
    q: sp.get('q')?.trim() ?? '',
    page: 1,
    pageSize: MAX_ROWS,
    sort: sp.get('sort') ?? 'healthScore',
    dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
  })

  const csv = toCsv(
    data.map((r) => ({
      username: r.username,
      status: r.status,
      health_score: r.healthScore,
      age_days: r.ageDays,
      post_karma: r.karmaPost,
      comment_karma: r.karmaComment,
      verified_subreddits: r.verifiedSubreddits.join(' '),
      creator: r.creatorName ?? '',
      poster: r.posterName ?? '',
      created_by: r.createdByName ?? '',
      proxy: r.proxyLabel ?? '',
      poll_tier: r.pollTier,
      last_checked_at: r.lastCheckedAt?.toISOString() ?? '',
      suspended_at: r.suspendedAt?.toISOString() ?? '',
      posts_30d: r.posts30d,
      removed_30d: r.removed30d,
      removal_rate: r.removalRate == null ? '' : fmtPct(r.removalRate),
      suspected_missed_posts: r.suspectedMissedPosts,
    })),
  )

  return csvResponse(`accounts-${new Date().toISOString().slice(0, 10)}.csv`, csv)
}
