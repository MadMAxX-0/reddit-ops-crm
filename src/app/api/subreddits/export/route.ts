import { NextRequest } from 'next/server'
import { requireManager } from '@/lib/session'
import { listSubreddits } from '@/lib/queries/subreddits'
import { parseFilters } from '@/lib/filters'
import { csvResponse, toCsv } from '@/lib/csv'
import { fmtPct } from '@/lib/format'

export async function GET(req: NextRequest) {
  const ctx = await requireManager()
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const filters = parseFilters(sp, ctx.workspace.dayBoundaryTimezone, { range: '30d' })
  const rows = await listSubreddits(filters.range, ctx.workspace.attributionWindowH)

  // Round-trips through the importer: the playbook columns come first, the
  // derived performance columns follow and are ignored on the way back in.
  return csvResponse(
    `subreddits-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      rows.map((s) => ({
        name: s.name,
        tier: s.tier,
        status: s.status,
        subscribers: s.subscribers,
        is_nsfw: s.isNsfw,
        verification_required: s.verificationRequired,
        min_karma: s.minKarma,
        min_account_age_days: s.minAccountAgeDays,
        post_cooldown_hours: s.postCooldownHours,
        allowed_flairs: s.allowedFlairs.join('|'),
        rules_summary: s.rulesSummary ?? '',
        posts_sent: s.posts,
        removed: s.removed,
        removal_rate: fmtPct(s.removalRate),
        median_upvotes: s.medianUpvotes ?? '',
        landings: s.landings,
        click_rate_proxy: fmtPct(s.ctrProxy),
        conversions: s.conversions,
        conv_rate: fmtPct(s.convRate, 2),
        revenue_cents: s.revenueCents,
        revenue_per_post_cents: s.revenuePerPostCents ?? '',
        suggested_tier: s.suggestedTier,
      })),
    ),
  )
}
