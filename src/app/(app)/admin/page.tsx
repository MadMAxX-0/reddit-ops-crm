import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/session'
import { parseFilters } from '@/lib/filters'
import { periodWithComparison } from '@/lib/queries/metrics'
import { managerDashboard } from '@/lib/queries/dashboard'
import { dayBounds, dayContextLine, todayKey } from '@/lib/time'
import { fmtCompact, fmtMoney, fmtMoneyCompact, fmtNum, fmtPct, pctChange } from '@/lib/format'
import { PageHeader } from '@/components/shell/page-header'
import { MetricCard } from '@/components/ui/metric-card'
import { Card } from '@/components/ui/card'
import { StatusDot, type Tone } from '@/components/ui/status-dot'
import { EmptyState } from '@/components/ui/empty-state'
import { RangeFilter } from '@/components/filters/range-filter'
import { Flame, Radar, ShieldAlert, Timer, UserMinus, Wallet } from 'lucide-react'

export const metadata = { title: 'Admin overview · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function AdminOverviewPage(props: PageProps<'/admin'>) {
  const sp = await props.searchParams
  const ctx = await requireManager()
  const boundaryTz = ctx.workspace.dayBoundaryTimezone
  const filters = parseFilters(sp, boundaryTz, { range: '30d' })
  const { start, end } = dayBounds(todayKey(boundaryTz), boundaryTz)

  const [{ current, prior }, alerts, costs, hours] = await Promise.all([
    periodWithComparison({}, filters.range, ctx.workspace.attributionWindowH),
    managerDashboard(start, end),
    // agency-wide account economics for the window
    prisma.$queryRaw<
      Array<{
        attempts: bigint
        successes: bigint
        cost: bigint
        refunded: bigint
        surviving: bigint
      }>
    >`
      SELECT COUNT(*) AS attempts,
             COUNT(*) FILTER (WHERE a.outcome = 'SUCCESS') AS successes,
             COALESCE(SUM(a."costCents"), 0) AS cost,
             COALESCE(SUM(a."refundedCents"), 0) AS refunded,
             COUNT(*) FILTER (
               WHERE a.outcome = 'SUCCESS' AND r."suspendedAt" IS NULL
             ) AS surviving
      FROM "AccountCreationAttempt" a
      LEFT JOIN "RedditAccount" r ON r.id = a."redditAccountId"
      WHERE a."createdAt" >= ${filters.range.start} AND a."createdAt" < ${filters.range.end}
    `,
    // VA hours in the window, from posting activity and farming sessions
    prisma.$queryRaw<Array<{ hours: number | null; cost: bigint }>>`
      WITH poster_hours AS (
        SELECT p."posterId" AS user_id,
               COUNT(DISTINCT date_trunc('hour', p."postedAt")) AS h
        FROM "Post" p
        WHERE p."posterId" IS NOT NULL
          AND p."postedAt" >= ${filters.range.start} AND p."postedAt" < ${filters.range.end}
        GROUP BY 1
      ),
      farmer_hours AS (
        SELECT s."farmerId" AS user_id, COALESCE(SUM(s."durationMin"), 0) / 60.0 AS h
        FROM "FarmingSession" s
        WHERE s."startedAt" >= ${filters.range.start} AND s."startedAt" < ${filters.range.end}
        GROUP BY 1
      ),
      all_hours AS (
        SELECT user_id, h FROM poster_hours
        UNION ALL SELECT user_id, h FROM farmer_hours
      )
      SELECT SUM(all_hours.h)::float AS hours,
             COALESCE(SUM(all_hours.h * u."hourlyCostCents"), 0)::bigint AS cost
      FROM all_hours JOIN "User" u ON u.id = all_hours.user_id
    `,
  ])

  const attempts = Number(costs[0]?.attempts ?? 0)
  const successes = Number(costs[0]?.successes ?? 0)
  const surviving = Number(costs[0]?.surviving ?? 0)
  const netCost = Number(costs[0]?.cost ?? 0) - Number(costs[0]?.refunded ?? 0)
  const costPerSurviving = surviving ? Math.round(netCost / surviving) : null

  const vaHours = hours[0]?.hours ?? 0
  const laborCents = Number(hours[0]?.cost ?? 0)
  const revenuePerHour = vaHours ? Math.round(current.revenueCents / vaHours) : null

  const strip: Array<{ tone: Tone; title: string; body: string; href: string }> = [
    alerts.scraperFailures > 0 && {
      tone: 'negative' as Tone,
      title: `${alerts.scraperFailures} scraper failures in 24h`,
      body: 'Anything the scraper misses does not exist as far as this database is concerned.',
      href: '/admin/scraper',
    },
    (current.removalRate ?? 0) > (prior.removalRate ?? 0) * 1.4 &&
      (current.removed ?? 0) > 10 && {
        tone: 'negative' as Tone,
        title: `Removal rate up sharply — ${fmtPct(current.removalRate, 1)} vs ${fmtPct(prior.removalRate, 1)}`,
        body: 'Check the subreddit breakdown before sending more volume.',
        href: '/admin/subreddits',
      },
    alerts.silentLinks > 0 && {
      tone: 'negative' as Tone,
      title: `${alerts.silentLinks} accounts posting with no landings`,
      body: 'Broken bio link or shadowban. Silent revenue loss either way.',
      href: '/accounts?links=1',
    },
    alerts.zeroOutput.length > 0 && {
      tone: 'warning' as Tone,
      title: `${alerts.zeroOutput.length} VAs at zero output today`,
      body: alerts.zeroOutput.map((z) => z.name).join(', '),
      href: '/pipeline',
    },
    alerts.needsAttribution > 0 && {
      tone: 'warning' as Tone,
      title: `${alerts.needsAttribution} posts need attribution`,
      body: 'They count for nobody until resolved.',
      href: '/posting/attribution',
    },
  ].filter(Boolean) as Array<{ tone: Tone; title: string; body: string; href: string }>

  const d = (a: number, b: number) => pctChange(a, b)

  return (
    <>
      <PageHeader
        title="Admin overview"
        context={`${dayContextLine(todayKey(boundaryTz), boundaryTz, ctx.user.timezone)} · ${filters.range.label.toLowerCase()}`}
        filters={<RangeFilter value={filters.range.preset} from={one(sp.from)} to={one(sp.to)} />}
      />

      <Card className="mb-4">
        <div className="border-hairline flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-15 text-fg font-semibold">Anomalies</h3>
          <span className="sublabel">
            removal spikes · quiet subreddits · zero output · scraper failures
          </span>
        </div>
        {strip.length === 0 ? (
          <EmptyState title="Nothing anomalous. Good." />
        ) : (
          <ul className="divide-hairline divide-y">
            {strip.map((a) => (
              <li key={a.title}>
                <Link
                  href={a.href}
                  className="hover:bg-surface-2 flex items-start gap-3 px-4 py-2.5"
                >
                  <StatusDot tone={a.tone} className="mt-1.5" />
                  <div className="min-w-0">
                    <div className="text-15 text-fg">{a.title}</div>
                    <div className="text-fg-muted text-13 leading-snug">{a.body}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Revenue"
          value={fmtMoneyCompact(current.revenueCents)}
          deltaPct={d(current.revenueCents, prior.revenueCents)}
          comparison={`${fmtMoneyCompact(current.revenuePerPostCents)} per post`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Posts"
          value={fmtNum(current.posts)}
          deltaPct={d(current.posts, prior.posts)}
          comparison={`${fmtCompact(current.landings)} landings · ${fmtPct(current.convRate, 2)} conv`}
          icon={<Radar className="h-4 w-4" />}
        />
        <MetricCard
          label="Active accounts"
          value={fmtNum(current.accountsUsed)}
          comparison="posted at least once in the window"
          icon={<Timer className="h-4 w-4" />}
        />
        <MetricCard
          label="Account burn rate"
          value={fmtPct(current.accountBurnRate, 1)}
          comparison={`${fmtNum(current.accountsBurned)} of ${fmtNum(current.accountsUsed)} used accounts suspended`}
          invertDelta
          icon={<Flame className="h-4 w-4" />}
        />
        <MetricCard
          label="Cost per surviving account"
          value={costPerSurviving == null ? '—' : fmtMoney(costPerSurviving)}
          comparison={`${fmtNum(surviving)} alive of ${fmtNum(successes)} made · ${fmtNum(attempts)} attempts`}
          icon={<UserMinus className="h-4 w-4" />}
        />
        <MetricCard
          label="Revenue per VA hour"
          value={revenuePerHour == null ? '—' : fmtMoney(revenuePerHour)}
          comparison={`${fmtNum(Math.round(vaHours))} hours · ${fmtMoneyCompact(laborCents)} labour`}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <p className="text-fg-muted text-13 mt-3 leading-relaxed">
        VA hours are estimated: distinct hours a poster had a post go live, plus logged farming
        session duration. Posting time follows the audience rather than a shift, so treat the figure
        as directional.
      </p>
    </>
  )
}
