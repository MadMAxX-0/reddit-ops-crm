import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/session'
import { parseFilters } from '@/lib/filters'
import { breakdown, periodWithComparison, recentPosts, timeSeries } from '@/lib/queries/metrics'
import { dayContextLine, todayKey } from '@/lib/time'
import { fmtCompact, fmtMoneyCompact, fmtNum, fmtPct, pctChange } from '@/lib/format'
import { PageHeader } from '@/components/shell/page-header'
import { MetricCard } from '@/components/ui/metric-card'
import { MultiSelectFilter } from '@/components/filters/multi-select'
import { RangeFilter, ScopeToggle } from '@/components/filters/range-filter'
import { PerformanceChart } from './performance-chart'
import { BreakdownTable } from './breakdown-table'
import { RecentPosts } from './recent-posts'
import {
  FileText,
  MousePointerClick,
  Send,
  ShieldAlert,
  ThumbsUp,
  UserPlus,
  Wallet,
} from 'lucide-react'

export const metadata = { title: 'Overview · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function OverviewPage(props: PageProps<'/overview'>) {
  const sp = await props.searchParams
  const ctx = await requireManager()
  const boundaryTz = ctx.workspace.dayBoundaryTimezone
  const filters = parseFilters(sp, boundaryTz, { range: '7d' })

  // Me / Everyone: a manager scoping to themselves means "posts I am the poster
  // of", which is rare but it is the same toggle the VAs see.
  const posterIds = filters.scope === 'me' ? [ctx.user.id] : filters.vaIds

  const metricFilters = {
    creatorIds: filters.creatorIds,
    posterIds,
    subredditIds: filters.subredditIds,
  }

  const [{ current, prior }, series, subs, creators, posts, creatorOptions, vaOptions, subOptions] =
    await Promise.all([
      periodWithComparison(metricFilters, filters.range, ctx.workspace.attributionWindowH),
      timeSeries(metricFilters, filters.range, boundaryTz, ctx.workspace.attributionWindowH),
      breakdown('subreddit', metricFilters, filters.range, ctx.workspace.attributionWindowH, 10),
      breakdown('creator', metricFilters, filters.range, ctx.workspace.attributionWindowH, 10),
      recentPosts(metricFilters, filters.range, 20),
      prisma.creator.findMany({
        where: { status: { not: 'CHURNED' } },
        orderBy: { stageName: 'asc' },
        select: { id: true, stageName: true, niche: true },
      }),
      prisma.user.findMany({
        where: { role: { in: ['POSTER', 'FARMER'] }, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true },
      }),
      prisma.subreddit.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, tier: true },
      }),
    ])

  const d = (a: number, b: number) => pctChange(a, b)

  return (
    <>
      <PageHeader
        title="Overview"
        context={`${dayContextLine(todayKey(boundaryTz), boundaryTz, ctx.user.timezone)} · ${filters.range.label.toLowerCase()} vs the ${filters.range.label.toLowerCase()} before`}
        filters={
          <>
            <ScopeToggle value={filters.scope} />
            <MultiSelectFilter
              paramKey="creator"
              label="Creator"
              selected={filters.creatorIds}
              options={creatorOptions.map((c) => ({
                value: c.id,
                label: c.stageName,
                sub: c.niche ?? undefined,
              }))}
            />
            <MultiSelectFilter
              paramKey="va"
              label="VA"
              selected={filters.vaIds}
              options={vaOptions.map((v) => ({
                value: v.id,
                label: v.name,
                sub: v.role.toLowerCase(),
              }))}
            />
            <MultiSelectFilter
              paramKey="sub"
              label="Subreddit"
              selected={filters.subredditIds}
              options={subOptions.map((s) => ({
                value: s.id,
                label: `r/${s.name}`,
                sub: `tier ${s.tier}`,
              }))}
            />
            <RangeFilter value={filters.range.preset} from={one(sp.from)} to={one(sp.to)} />
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total posts"
          value={fmtNum(current.posts)}
          deltaPct={d(current.posts, prior.posts)}
          comparison={`vs ${fmtNum(prior.posts)} last period`}
          icon={<Send className="h-4 w-4" />}
        />
        <MetricCard
          label="Upvotes"
          value={fmtCompact(current.upvotes)}
          deltaPct={d(current.upvotes, prior.upvotes)}
          comparison={`median ${fmtNum(current.medianUpvotes ?? 0)} per post`}
          icon={<ThumbsUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Landings"
          value={fmtCompact(current.landings)}
          deltaPct={d(current.landings, prior.landings)}
          comparison={`${fmtPct(current.ctrProxy, 1)} of upvotes — a proxy for reach`}
          icon={<MousePointerClick className="h-4 w-4" />}
        />
        <MetricCard
          label="Funnel pass rate"
          value={fmtPct(current.funnelPass)}
          deltaPct={d(current.funnelPass ?? 0, prior.funnelPass ?? 0)}
          comparison={`${fmtCompact(current.outbound)} clicked through`}
          icon={<FileText className="h-4 w-4" />}
        />
        <MetricCard
          label="New subs"
          value={fmtNum(current.newSubs)}
          deltaPct={d(current.newSubs, prior.newSubs)}
          comparison={`${fmtPct(current.convRate, 2)} of landings`}
          icon={<UserPlus className="h-4 w-4" />}
        />
        <MetricCard
          label="Revenue"
          value={fmtMoneyCompact(current.revenueCents)}
          deltaPct={d(current.revenueCents, prior.revenueCents)}
          comparison={`${fmtMoneyCompact(current.revenuePerPostCents)} per post`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Removed posts"
          value={fmtNum(current.removed)}
          deltaPct={d(current.removed, prior.removed)}
          comparison={`${fmtPct(current.removalRate, 1)} removal rate`}
          invertDelta
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <MetricCard
          label="Discovery lag"
          value={current.medianDiscoveryLagMin == null ? '—' : `${current.medianDiscoveryLagMin}m`}
          comparison="median postedAt → firstSeenAt"
          icon={<Send className="h-4 w-4" />}
        />
      </div>

      <PerformanceChart
        points={series.points}
        granularity={series.granularity}
        displayTz={ctx.user.timezone}
        className="mb-4"
      />

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <BreakdownTable title="Top subreddits" rows={subs} nameHeader="Subreddit" />
        <BreakdownTable title="Top creators" rows={creators} nameHeader="Creator" />
      </div>

      <RecentPosts
        posts={posts.map((p) => ({
          id: p.id,
          title: p.title,
          postedAt: p.postedAt,
          lagMin: Math.round((p.firstSeenAt.getTime() - p.postedAt.getTime()) / 60_000),
          status: p.status,
          attributionStatus: p.attributionStatus,
          upvotes: p.latestUpvotes,
          landings: p._count.funnelEvents,
          url: p.url,
          subreddit: p.subreddit.name,
          tier: p.subreddit.tier,
          accountId: p.redditAccount.id,
          username: p.redditAccount.username,
          creatorName: p.creator?.stageName ?? null,
          posterName: p.poster?.name ?? null,
        }))}
        displayTz={ctx.user.timezone}
      />

      {current.unattributedLandings > 0 && (
        <p className="text-fg-muted text-13 mt-3">
          {fmtNum(current.unattributedLandings)} landings in this window could not be tied to any
          post — traffic arriving with nothing live in the attribution window. They are excluded
          from every rate above.
        </p>
      )}
    </>
  )
}
