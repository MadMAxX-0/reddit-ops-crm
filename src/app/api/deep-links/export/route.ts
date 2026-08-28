import { NextRequest } from 'next/server'
import { requireCtx } from '@/lib/session'
import { listDeepLinks } from '@/lib/queries/deep-links'
import { parseFilters } from '@/lib/filters'
import { csvResponse, toCsv } from '@/lib/csv'
import { fmtPct } from '@/lib/format'

export async function GET(req: NextRequest) {
  const ctx = await requireCtx()
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const filters = parseFilters(sp, ctx.workspace.dayBoundaryTimezone, { range: '30d' })

  const { data } = await listDeepLinks(ctx, filters.range, {
    creatorIds: filters.creatorIds,
    posterIds: filters.vaIds,
    q: filters.q,
    page: 1,
    pageSize: 20_000,
    sort: filters.sort ?? 'revenue',
    dir: filters.dir,
    onlySilent: sp.silent === '1',
  })

  return csvResponse(
    `deep-links-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      data.map((r) => ({
        account: r.username,
        creator: r.creatorName ?? '',
        poster: r.posterName ?? '',
        slug: r.slug,
        funnel_url: r.funnelUrl,
        of_tracking_link_id: r.ofTrackingLinkId ?? '',
        landings: r.landings,
        unique_landings: r.uniqueLandings,
        bot_landings: r.botLandings,
        outbound: r.outbound,
        funnel_pass: r.funnelPass == null ? '' : fmtPct(r.funnelPass),
        conversions: r.conversions,
        revenue_cents: r.revenueCents,
        revenue_per_landing_cents: r.revenuePerLandingCents ?? '',
        live_posts_7d: r.livePosts,
        silent_48h: r.silent ? 'yes' : 'no',
      })),
    ),
  )
}
