'use client'

import * as React from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import {
  AREA_PROPS,
  AreaGradient,
  CHART_COLORS,
  DarkTooltip,
  Grid,
  XA,
  YA,
} from '@/components/ui/chart-theme'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtCompact, fmtMoney, fmtMoneyCompact, fmtNum, fmtPct, pctChange } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TopPosts, type TopPostRow } from './top-posts'

/**
 * The dashboard: six numbers, how they moved, and who moved them.
 *
 * Each card shows the figure against the same length of time immediately
 * before it, because a number with nothing to compare it to cannot tell you
 * whether to do anything differently.
 */

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
] as const

/**
 * Whose spending to count. "New" is money from fans who first arrived through a
 * tracked link inside the window; "returning" is money from fans earlier work
 * brought in, who are still paying. Returning is not a rounding error here — it
 * is routinely half the total, and it is the part a month-by-month reading of
 * revenue throws away.
 */
const FANS = [
  { value: 'all', label: 'All fans' },
  { value: 'new', label: 'New fans' },
  { value: 'returning', label: 'Returning' },
] as const

export interface Totals {
  /**
   * null means "not measurable", never "zero" — either the tracking-link
   * readings do not cover the window, or the selected model's OnlyFans account
   * is not connected, so there is no key to count against.
   */
  clicks: number | null
  subs: number | null
  revenueCents: number | null
  /**
   * Read off Reddit, so never null. These three hold up when the OnlyFans
   * side is dark: an unconnected model still posts, and the posting is still
   * the work being managed.
   */
  posts: number
  upvotes: number
  comments: number
  /** of `posts`, how many are still standing */
  live: number
}

/** One day on the chart, with every metric it can draw. */
export interface ChartDay {
  day: string
  clicks: number
  subs: number
  revenueCents: number
  /** read off Reddit — present whether or not the model is connected */
  posts: number
  comments: number
  avgUpvotes: number
}

export interface LinkBasis {
  basis: 'window' | 'partial' | 'none'
  since: string | null
  redditLinkCount: number
  linkCount: number
  share: number | null
  /** share of the period's money that could be traced to any link at all */
  coverage: number | null
  untracedCents: number
  otherLinkCents: number
  redditPayments: number
  redditLinksShort: number
  lifetimeClicks: number
  /** of the clicks, the portion whose referrer was Reddit */
  clicksFromReddit: number
  /** tracked links that have a bouncy link, so a click figure at all */
  clickLinksCovered: number
  /** newest subscribe date on record — a window past this is under-counted */
  subsThrough: string | null
  /** subs counted off a claim date because the fan has no subscriber record */
  subsFromClaimDate: number
  /** Reddit money from fans who arrived inside the window, and from earlier ones */
  newFanCents: number
  returningFanCents: number
  newFans: number
  returningFans: number
}

type Metric = 'clicks' | 'subs' | 'revenueCents' | 'posts' | 'avgUpvotes' | 'comments'

/**
 * The three charts, stacked in funnel order — clicks arrive, some become fans,
 * some fans spend. Each keeps its own panel and its own axis: overlaying them
 * meant three scales fighting over one gridline, and the small one always lost.
 * Read down the page and the same day lines up across all three.
 */
const METRICS: Record<
  Metric,
  { label: string; note: string; color: string; tint: string; money?: boolean; reddit?: boolean }
> = {
  clicks: {
    label: 'Clicks',
    note: 'hits on the tracking links in the Reddit bios, from bouncy',
    color: CHART_COLORS.accent,
    tint: '#FFB185',
  },
  subs: {
    label: 'Fans',
    note: 'subscribers who arrived through one of those links',
    color: CHART_COLORS.positive,
    tint: '#87E7AF',
  },
  revenueCents: {
    label: 'Revenue',
    note: 'every payment traced to a fan a Reddit link brought in',
    color: CHART_COLORS.info,
    tint: CHART_COLORS.infoTint,
    money: true,
  },
  // Outcome first, then the work behind it. Clicks, fans and revenue are
  // what the operation is judged on; posts, upvotes and comments explain a
  // move in them. The second three are read off Reddit and stay populated
  // even when a model is not connected to OnlyFans.
  posts: {
    label: 'Posts out',
    note: 'submissions made by the accounts we run',
    color: CHART_COLORS.violet,
    tint: '#C7B6FD',
    reddit: true,
  },
  avgUpvotes: {
    label: 'Average upvotes',
    note: 'per post that day — volume has its own line, this is how well it landed',
    color: CHART_COLORS.warning,
    tint: '#FFD79A',
    reddit: true,
  },
  comments: {
    label: 'Comments',
    note: 'replies our posts drew — not comments our accounts leave elsewhere',
    color: CHART_COLORS.info,
    tint: CHART_COLORS.infoTint,
    reddit: true,
  },
}

const METRIC_ORDER = Object.keys(METRICS) as Metric[]

export function DashboardView({
  name,
  preset,
  fans,
  model,
  models,
  modelLinked,
  rangeLabel,
  current,
  prior,
  chartSeries,
  topPosts,
  links,
  of,
}: {
  name: string
  preset: string
  fans: string
  model: string
  models: { id: string; name: string; linked: boolean }[]
  modelLinked: boolean
  rangeLabel: string
  current: Totals
  prior: Totals
  chartSeries: ChartDay[]
  topPosts: TopPostRow[]
  links: LinkBasis
  of: {
    linkedCreators: number
    unlinkedCreators: string[]
    syncedAt: string | null
  }
}) {
  const { set } = useFilterNav()

  const chart = chartSeries.map((d) => ({
    label: new Date(d.day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    // revenue is plotted in whole currency so its axis reads in dollars
    revenueCents: d.revenueCents / 100,
    clicks: d.clicks,
    subs: d.subs,
    posts: d.posts,
    comments: d.comments,
    avgUpvotes: d.avgUpvotes,
  }))

  return (
    <div className="space-y-4">
      <h1 className="text-24 text-fg font-semibold">Welcome back, {name.split(' ')[0]}!</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-surface border-hairline flex items-center gap-1 rounded-[8px] border p-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => set({ range: r.value })}
              className={cn(
                'text-14 h-7 rounded-[6px] px-3 transition-colors',
                preset === r.value
                  ? 'bg-surface-2 text-fg font-medium'
                  : 'text-fg-secondary hover:text-fg',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="bg-surface border-hairline flex items-center gap-1 rounded-[8px] border p-1">
          {FANS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => set({ fans: f.value === 'all' ? undefined : f.value })}
              className={cn(
                'text-14 h-7 rounded-[6px] px-3 transition-colors',
                fans === f.value
                  ? 'bg-surface-2 text-fg font-medium'
                  : 'text-fg-secondary hover:text-fg',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* A select rather than a button row: the roster grows, and eleven
            models across a filter bar pushes the range picker off the line. */}
        <label className="bg-surface border-hairline text-14 text-fg-secondary inline-flex h-9 items-center gap-2 rounded-[8px] border px-3">
          <span className="text-fg-muted">Model</span>
          <select
            value={model}
            onChange={(e) => set({ model: e.target.value === 'all' ? undefined : e.target.value })}
            className="text-14 text-fg cursor-pointer appearance-none bg-transparent pr-1 outline-none"
          >
            <option value="all">All models</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.linked ? '' : ' (not connected)'}
              </option>
            ))}
          </select>
        </label>
        <span className="bg-surface border-hairline text-14 text-fg-secondary inline-flex h-9 items-center gap-2 rounded-[8px] border px-3">
          <span className="border-fg-muted h-2.5 w-2.5 rounded-full border" />
          {rangeLabel}
        </span>
      </div>

      {!modelLinked && (
        <div className="border-warning/40 bg-warning/10 text-14 text-fg-secondary rounded-[10px] border px-4 py-3 leading-relaxed">
          <span className="text-warning font-medium">
            {models.find((m) => m.id === model)?.name ?? 'This model'} is not connected to OnlyFans.
          </span>{' '}
          Her OnlyFans account is not in the panel the CRM reads, so there are no tracking links to
          count against — clicks, fans and revenue cannot be measured for her and are shown as a
          dash rather than a zero. Posting is still counted: the chart&rsquo;s Posts line and the
          account pipeline work from Reddit, not from OnlyFans. Adding the account to the panel is
          what turns the rest on.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Card
          label="Total clicks"
          value={current.clicks == null ? '—' : fmtNum(current.clicks)}
          delta={current.clicks == null ? null : pctChange(current.clicks, prior.clicks ?? 0)}
          prior={prior.clicks == null ? 'no reading' : fmtNum(prior.clicks)}
          note={
            current.clicks
              ? `${fmtNum(links.clicksFromReddit)} referred by Reddit itself`
              : `no bouncy link on any counted link yet`
          }
          highlight
        />
        <Card
          label="Fans"
          value={current.subs == null ? '—' : fmtCompact(current.subs)}
          delta={current.subs == null ? null : pctChange(current.subs, prior.subs ?? 0)}
          prior={prior.subs == null ? '0' : fmtCompact(prior.subs)}
          note="fans who joined through a Reddit link"
        />
        <Card
          label="Revenue"
          value={current.revenueCents == null ? '—' : fmtMoney(current.revenueCents)}
          delta={
            current.revenueCents == null
              ? null
              : pctChange(current.revenueCents, prior.revenueCents ?? 0)
          }
          prior={prior.revenueCents == null ? 'not connected' : fmtMoney(prior.revenueCents)}
          split={
            current.revenueCents != null && fans === 'all'
              ? [
                  { label: 'new fans', value: fmtMoney(links.newFanCents), count: links.newFans },
                  {
                    label: 'returning',
                    value: fmtMoney(links.returningFanCents),
                    count: links.returningFans,
                  },
                ]
              : undefined
          }
          note={
            fans === 'new'
              ? `${fmtNum(links.newFans)} fans who arrived this period`
              : fans === 'returning'
                ? `${fmtNum(links.returningFans)} fans from earlier, still spending`
                : undefined
          }
        />
        <Card
          label="Posts"
          value={fmtNum(current.posts)}
          delta={pctChange(current.posts, prior.posts)}
          prior={fmtNum(prior.posts)}
          note={
            current.posts
              ? `${fmtNum(current.live)} still live · ${fmtNum(current.posts - current.live)} removed · active accounts only`
              : 'nothing posted by an active account in this window'
          }
        />
        <Card
          label="Upvotes"
          value={fmtNum(current.upvotes)}
          delta={pctChange(current.upvotes, prior.upvotes)}
          prior={fmtNum(prior.upvotes)}
          note={
            current.posts
              ? `${fmtNum(Math.round(current.upvotes / current.posts))} per post on average`
              : undefined
          }
        />
        <Card
          label="Comments"
          value={fmtNum(current.comments)}
          delta={pctChange(current.comments, prior.comments)}
          prior={fmtNum(prior.comments)}
          note="replies drawn by those posts — comments our accounts leave elsewhere are not tracked yet"
        />
      </div>

      {/* Three panels, one per stage of the funnel, sharing an x-axis by
          sitting directly above each other. A day that spikes in clicks and
          not in fans is visible by reading straight down the page. */}
      <div className="space-y-3">
        {METRIC_ORDER.map((m) => {
          const meta = METRICS[m]
          const empty = chart.length < 2 || chart.every((d) => (d[m] as number) === 0)
          return (
            <div key={m} className="bg-surface border-hairline rounded-[10px] border">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4 pb-1">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: meta.color }}
                    aria-hidden
                  />
                  <span className="text-15 text-fg font-medium">{meta.label}</span>
                </span>
                <span className="text-fg-muted text-13">{meta.note}</span>
              </div>

              {empty ? (
                <EmptyState
                  title={
                    modelLinked || meta.reddit
                      ? `Nothing measured for ${meta.label.toLowerCase()} in this window.`
                      : 'Not measurable while this model is not connected to OnlyFans.'
                  }
                />
              ) : (
                <div className="h-52 px-1 pt-2 pb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
                      <defs>
                        <AreaGradient id={`fill-${m}`} color={meta.color} tint={meta.tint} />
                      </defs>
                      <Grid />
                      <XA dataKey="label" />
                      <YA
                        tickFormatter={(v: number) =>
                          meta.money ? fmtMoneyCompact(v * 100) : fmtCompact(v)
                        }
                      />
                      <DarkTooltip
                        formatter={(v) => [
                          meta.money ? fmtMoney(Number(v) * 100) : fmtNum(Number(v)),
                          meta.label,
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey={m}
                        name={meta.label}
                        stroke={meta.color}
                        fill={`url(#fill-${m})`}
                        {...AREA_PROPS}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* the revenue panel is where "what actually worked" belongs —
                  the money is the reason anyone is reading the page */}
              {m === 'revenueCents' && (
                <div className="border-hairline border-t">
                  <TopPosts posts={topPosts} rangeLabel={rangeLabel} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-fg-muted text-13 space-y-1 leading-relaxed">
        <p>
          Clicks, subs and revenue are Reddit only — counted from the{' '}
          {fmtNum(links.redditLinkCount)} OnlyFans tracking links the Reddit bios use, out of{' '}
          {fmtNum(links.linkCount)} links in the panel. Instagram, Twitter and DM traffic is
          excluded.
          {of.syncedAt && ` Last synced ${new Date(of.syncedAt).toLocaleString('en-GB')}.`}
        </p>
        <p>
          Revenue is traced payment by payment: OnlyFans records which link each fan came through,
          and every payment against the fan who made it. Nothing is apportioned, and a fan Reddit
          brought in long ago still counts as Reddit&rsquo;s the day they spend.
        </p>
        <p>
          {links.redditLinksShort === 0 ? (
            <>
              All {fmtNum(links.redditLinkCount)} Reddit links have had their full fan lists walked,
              so the Reddit figure is complete.
            </>
          ) : (
            <span className="text-warning">
              {links.redditLinksShort} Reddit{' '}
              {links.redditLinksShort === 1 ? 'link has' : 'links have'} an incomplete fan list, so
              Reddit is undercounted here — run `npm run of:claims:walk`.
            </span>
          )}{' '}
          {links.coverage != null && (
            <>
              Across all sources {fmtPct(links.coverage, 0)} of this period&rsquo;s money traces to
              a link; the other {fmtMoney(links.untracedCents)} is from fans who arrived through no
              link at all, or through a non-Reddit link whose list has not been walked.
            </>
          )}
        </p>
        {links.basis !== 'window' && (
          <p className="text-warning">
            Clicks are a lifetime counter on each link, so a figure for a window is the difference
            between two readings — and readings only began{' '}
            {links.since ? new Date(links.since).toLocaleString('en-GB') : 'on the first sync'}.
            Windows starting before that show a dash rather than a made-up number. Subscribers do
            not have this problem: they are counted from the fans themselves.
          </p>
        )}
        <p>
          Subscriber arrivals come from OnlyMonster, which logged them as they happened and still
          holds fans whose OnlyFans accounts have since been deleted. Per-link counts reconcile
          exactly with its Traffic Metrics screen.
        </p>
        {of.unlinkedCreators.length > 0 && (
          <p className="text-warning">
            {of.unlinkedCreators.join(', ')} {of.unlinkedCreators.length === 1 ? 'is' : 'are'} not
            connected to OnlyFans, so nothing they earn is counted here yet.
          </p>
        )}
      </div>
    </div>
  )
}

function Card({
  label,
  value,
  delta,
  prior,
  highlight,
  invert,
  note,
  split,
}: {
  label: string
  value: string
  delta: number | null
  prior: string
  highlight?: boolean
  invert?: boolean
  note?: string
  /** a figure worth breaking apart, shown under the headline */
  split?: Array<{ label: string; value: string; count: number }>
}) {
  const up = delta != null && delta > 0
  const flat = delta === 0 || delta == null
  const good = invert ? !up : up

  return (
    <div
      className={cn(
        'bg-surface rounded-[10px] border px-4 py-3.5',
        highlight ? 'border-info/60' : 'border-hairline',
      )}
    >
      <div className="text-fg-secondary text-14">{label}</div>
      <div className="kpi mt-1">{value}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-13 font-medium',
            flat ? 'text-fg-muted' : good ? 'text-positive' : 'text-negative',
          )}
        >
          {delta == null ? '—' : `${up ? '↑' : '↓'} ${Math.abs(delta * 100).toFixed(0)}%`}
        </span>
        <span className="text-fg-muted text-13">vs {prior} last period</span>
      </div>
      {note && <div className="text-fg-muted mt-1 text-13">{note}</div>}
      {split && (
        <div className="border-hairline mt-2.5 flex items-baseline gap-4 border-t pt-2">
          {split.map((s) => (
            <div key={s.label}>
              <div className="text-fg-muted text-13">{s.label}</div>
              <div className="mono text-15 text-fg tabular-nums">{s.value}</div>
              <div className="text-fg-muted text-13">
                {fmtNum(s.count)} {s.count === 1 ? 'fan' : 'fans'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
