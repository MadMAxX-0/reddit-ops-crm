import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { dailyOutput, goalStreak, peerRank, qualityMetrics } from '@/lib/queries/scorecard'
import { dayBounds, dayContextLine, todayKey } from '@/lib/time'
import { resolveRange } from '@/lib/time'
import { PageHeader } from '@/components/shell/page-header'
import { StatRow } from '@/components/ui/stat-row'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtDuration, fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { OutputChart } from './output-chart'
import { PeerRank } from './peer-rank'
import { VaPicker } from './va-picker'

export const metadata = { title: 'My performance · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function MyPerformancePage(props: PageProps<'/my-performance'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const boundaryTz = ctx.workspace.dayBoundaryTimezone
  const key = todayKey(boundaryTz)

  // A VA is always scoped to themselves. A manager may open a VA's scorecard,
  // which shows output and quality — never pay, never anything personal.
  const requested = ctx.isManager ? one(sp.va) : null
  const subjectId = requested ?? ctx.user.id

  const subject = await prisma.user.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      name: true,
      role: true,
      timezone: true,
      dailyAccountGoal: true,
      dailyPostGoal: true,
    },
  })
  if (!subject) redirect('/my-performance')
  if (subject.role === 'MANAGER' || subject.role === 'ADMIN') {
    return (
      <>
        <PageHeader
          title="My performance"
          context={dayContextLine(key, boundaryTz, ctx.user.timezone)}
        />
        <Card>
          <EmptyState
            title="Managers are not scored here."
            hint="Open a VA from the Employee ranking to see their scorecard."
          />
        </Card>
      </>
    )
  }

  const role = subject.role as 'POSTER' | 'FARMER'
  const goal = role === 'FARMER' ? subject.dailyAccountGoal : subject.dailyPostGoal
  const range = resolveRange('30d', boundaryTz)
  const { start } = dayBounds(key, boundaryTz)

  const [points, quality, ranks, peers] = await Promise.all([
    dailyOutput(subject.id, role, goal, boundaryTz, 30),
    qualityMetrics(subject.id, role, range.start, range.end, ctx.workspace.attributionWindowH),
    peerRank(subject.id, role, key, boundaryTz),
    ctx.isManager
      ? prisma.user.findMany({
          where: { role: { in: ['POSTER', 'FARMER'] }, status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, role: true },
        })
      : Promise.resolve([]),
  ])

  const streak = goalStreak(points)
  const today = points[points.length - 1]
  void start

  return (
    <>
      <PageHeader
        title={ctx.isManager && requested ? `${subject.name} · performance` : 'My performance'}
        context={`${dayContextLine(key, boundaryTz, ctx.user.timezone)} · ${role.toLowerCase()} · last 30 days`}
        filters={ctx.isManager ? <VaPicker vas={peers} value={subject.id} /> : undefined}
      />

      <StatRow
        className="mb-4"
        stats={[
          {
            label: 'Today',
            value: `${today?.value ?? 0}/${goal}`,
            sub: today?.met ? 'goal met' : `${Math.max(0, goal - (today?.value ?? 0))} to go`,
            tone: today?.met ? 'default' : 'accent',
          },
          {
            label: 'Goal streak',
            value: streak.current,
            sub: `best ${streak.best} · hit ${fmtPct(streak.hitRate, 0)} of 30 days`,
            tone: streak.current > 0 ? 'accent' : 'muted',
          },
          role === 'POSTER'
            ? {
                label: 'Median upvotes',
                value: fmtNum(quality.medianUpvotes ?? 0),
                sub: `${fmtNum(quality.posts)} posts in 30d`,
              }
            : {
                label: 'Accounts made',
                value: fmtNum(quality.accountsMade),
                sub: `${quality.accountsToReady} now posting-ready`,
              },
          role === 'POSTER'
            ? {
                label: 'Removal rate',
                value: fmtPct(quality.removalRate, 1),
                sub: 'lower is better',
                tone:
                  quality.removalRate == null
                    ? 'muted'
                    : quality.removalRate > 0.15
                      ? 'negative'
                      : 'default',
              }
            : {
                label: '7d survival',
                value: fmtPct(quality.survival7d, 1),
                sub: 'the quality metric that matters',
                tone:
                  quality.survival7d == null
                    ? 'muted'
                    : quality.survival7d >= 0.8
                      ? 'default'
                      : quality.survival7d >= 0.6
                        ? 'warning'
                        : 'negative',
              },
          role === 'POSTER'
            ? {
                label: 'Click-through',
                value: fmtPct(quality.ctrProxy, 1),
                sub: `${fmtNum(quality.landings)} landings · reach proxy`,
              }
            : {
                label: 'Karma per hour',
                value:
                  quality.karmaPerHour == null ? '—' : fmtNum(Math.round(quality.karmaPerHour)),
                sub: `${quality.sessions} sessions · ${fmtDuration(quality.sessionMinutes)}`,
              },
          role === 'POSTER'
            ? {
                label: 'Revenue',
                value: fmtMoney(quality.revenueCents),
                sub: `${quality.conversions} subs · ${fmtPct(quality.convRate, 2)} of landings`,
                tone: 'accent',
              }
            : {
                label: 'Success rate',
                value: fmtPct(quality.successRate, 1),
                sub: 'successful attempts',
              },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <OutputChart points={points} role={role} />
        <PeerRank ranks={ranks} role={role} />
      </div>
    </>
  )
}
