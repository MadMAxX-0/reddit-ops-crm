import { requireCtx } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { onlyFansMetrics } from '@/lib/queries/onlyfans-metrics'
import { redditDailySeries, redditLinkComparison } from '@/lib/queries/reddit-links'
import { clickTotals } from '@/lib/queries/clicks'
import { postEngagement, postEngagementSeries } from '@/lib/queries/post-engagement'
import { topPosts } from '@/lib/queries/posting'
import {
  redditSubs,
  redditSubsDated,
  subscriberDataThrough,
  tracedRevenue,
  type FanFilter,
} from '@/lib/queries/traced-revenue'
import { resolveRange, type RangePreset } from '@/lib/time'
import { DashboardView } from './dashboard-view'

export const metadata = { title: 'Dashboard · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

const PRESETS: RangePreset[] = ['24h', '7d', '30d']
const FAN_FILTERS: FanFilter[] = ['all', 'new', 'returning']

/**
 * Clicks, subs and revenue are Reddit's, not OnlyFans' in total: they come from
 * the OnlyFans tracking links the bios point at, so Instagram and Twitter
 * traffic is not counted as something the Reddit team earned. A counter that
 * moves when a VA does nothing is a counter nobody can be held to.
 */
export default async function DashboardPage(props: PageProps<'/dashboard'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const boundaryTz = ctx.workspace.dayBoundaryTimezone

  const raw = one(sp.range)
  const preset = (PRESETS.includes(raw as RangePreset) ? raw : '7d') as RangePreset
  const range = resolveRange(preset, boundaryTz)

  // whose spending to count: everyone, only fans who arrived in this window, or
  // only the ones earlier work brought in and who are still paying

  const rawFans = one(sp.fans)
  const fans = (FAN_FILTERS.includes(rawFans as FanFilter) ? rawFans : 'all') as FanFilter

  // Which model's traffic to show. Every model is listed, including the ones
  // whose OnlyFans account is not connected — they are models the team works,
  // and leaving them out of the picker makes the CRM look like it has never
  // heard of them. What changes for those is the ANSWER, not the option: the
  // money side has no key to join on, so it reports "not connected" rather than
  // a zero that reads as "earned nothing".
  const models = await prisma.creator.findMany({
    select: { id: true, stageName: true, ofUserId: true },
    orderBy: { stageName: 'asc' },
  })
  const rawModel = one(sp.model)
  const model = models.find((m) => m.id === rawModel) ?? null
  const linked = !model || !!model.ofUserId
  // A selected model with no OnlyFans id must not fall back to "everyone" — the
  // whole roster's revenue under one model's name is the worst possible answer.
  const ofUserIds = model ? [model.ofUserId ?? '__unconnected__'] : undefined
  const [
    of,
    links,
    redditSeries,
    money,
    priorMoney,
    subs,
    priorSubs,
    subsThrough,
    subsDated,
    clicks,
    priorClicks,
    best,
    engagement,
    priorEngagement,
    engagementSeries,
  ] = await Promise.all([
    onlyFansMetrics(preset),
    redditLinkComparison(range),
    redditDailySeries(range.start, range.end, fans, ofUserIds),
    tracedRevenue(range.start, range.end, { fans, ofUserIds }),
    tracedRevenue(range.prevStart, range.prevEnd, { fans, ofUserIds }),
    redditSubs(range.start, range.end, ofUserIds),
    redditSubs(range.prevStart, range.prevEnd, ofUserIds),
    subscriberDataThrough(),
    redditSubsDated(range.start, range.end),
    clickTotals(range.start, range.end, ofUserIds),
    clickTotals(range.prevStart, range.prevEnd, ofUserIds),
    topPosts(range.start, range.end, 8, model ? [model.id] : undefined),
    // Scoped by Creator, not by OnlyFans id: posting exists whether or not the
    // model's account has ever been connected, so these three never blank out.
    postEngagement(range.start, range.end, model ? [model.id] : undefined),
    postEngagement(range.prevStart, range.prevEnd, model ? [model.id] : undefined),
    postEngagementSeries(range.start, range.end, model ? [model.id] : undefined),
  ])

  // One row per day for the three stacked charts. bouncy files clicks by day,
  // arrivals and payments are traced to the fan and dated from there, so they
  // are joined on the calendar day they share and every panel lines up.
  // Posting is keyed by day too, so it joins the click/arrival/payment spine on
  // the calendar day they share and every panel lines up when read downward.
  const postsByDay = new Map(engagementSeries.map((d) => [d.day, d]))
  const chartSeries = redditSeries.map((r) => {
    const p = postsByDay.get(r.day)
    return {
      day: r.day,
      revenueCents: r.revenueCents,
      clicks: r.clicks,
      subs: r.subs,
      posts: p?.posts ?? 0,
      comments: p?.comments ?? 0,
      avgUpvotes: p?.avgUpvotes ?? 0,
    }
  })

  return (
    <DashboardView
      name={ctx.user.name}
      preset={preset}
      fans={fans}
      model={model?.id ?? 'all'}
      models={models.map((m) => ({ id: m.id, name: m.stageName, linked: !!m.ofUserId }))}
      modelLinked={linked}
      rangeLabel={range.label}
      current={{
        // bouncy logs every hit with its date, so this works for any window
        clicks: linked ? clicks.clicks : null,
        // counted from the fans themselves, so this works for any window
        subs: linked ? subs : null,
        revenueCents: linked ? money.redditCents : null,
        // Never gated on `linked`: these are read off Reddit, not OnlyFans.
        posts: engagement.posts,
        upvotes: engagement.upvotes,
        comments: engagement.comments,
        live: engagement.live,
      }}
      prior={{
        clicks: linked ? priorClicks.clicks : null,
        subs: linked ? priorSubs : null,
        revenueCents: linked ? priorMoney.redditCents : null,
        posts: priorEngagement.posts,
        upvotes: priorEngagement.upvotes,
        comments: priorEngagement.comments,
        live: priorEngagement.live,
      }}
      chartSeries={chartSeries}
      topPosts={best.map((p) => ({
        ...p,
        postedAt: p.postedAt.toISOString(),
      }))}
      links={{
        basis: links.current.basis,
        coverage: money.coverage,
        newFanCents: money.redditNewFanCents,
        returningFanCents: money.redditReturningFanCents,
        newFans: money.redditNewFans,
        returningFans: money.redditReturningFans,
        untracedCents: money.untracedCents,
        otherLinkCents: money.otherLinkCents,
        redditPayments: money.redditTransactions,
        subsThrough: subsThrough ? subsThrough.toISOString() : null,
        subsFromClaimDate: subsDated.fromClaimDate,
        since: links.current.since ? links.current.since.toISOString() : null,
        redditLinkCount: links.current.redditLinkCount,
        linkCount: links.current.linkCount,
        share: links.current.redditShare,
        redditLinksShort: links.current.redditLinksShort,
        lifetimeClicks: links.current.lifetimeClicks,
        clicksFromReddit: clicks.fromReddit,
        clickLinksCovered: clicks.linksCovered,
      }}
      of={{
        linkedCreators: of.linkedCreators,
        unlinkedCreators: of.unlinkedCreators,
        syncedAt: of.syncedAt ? of.syncedAt.toISOString() : null,
      }}
    />
  )
}
