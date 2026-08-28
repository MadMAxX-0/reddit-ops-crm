import { requireManager } from '@/lib/session'
import { accountPerformance } from '@/lib/queries/account-performance'
import { redditLinkComparison } from '@/lib/queries/reddit-links'
import { tracedRevenue, type FanFilter } from '@/lib/queries/traced-revenue'
import { onlyFansMetrics } from '@/lib/queries/onlyfans-metrics'
import { resolveRange, type RangePreset } from '@/lib/time'
import { postingVolume } from '@/lib/queries/posting-volume'
import { PerformanceView } from './performance-view'

export const metadata = { title: 'Performance · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

const PRESETS: RangePreset[] = ['24h', '7d', '30d']
const FAN_FILTERS: FanFilter[] = ['all', 'new', 'returning']

/**
 * Who produced what, account by account, grouped by the VA who works them.
 *
 * This lived on the dashboard, which made the front page a report about six
 * people instead of a state of play. It belongs here: the dashboard answers
 * "how is Reddit doing", this answers "who did it".
 */
export default async function PerformancePage(props: PageProps<'/admin/performance'>) {
  const sp = await props.searchParams
  const ctx = await requireManager()

  const raw = one(sp.range)
  const preset = (PRESETS.includes(raw as RangePreset) ? raw : '7d') as RangePreset
  const range = resolveRange(preset, ctx.workspace.dayBoundaryTimezone)

  const rawFans = one(sp.fans)
  const fans = (FAN_FILTERS.includes(rawFans as FanFilter) ? rawFans : 'all') as FanFilter

  const [groups, money, links, of, volume] = await Promise.all([
    accountPerformance(range, ctx.workspace.attributionWindowH, undefined, fans),
    tracedRevenue(range.start, range.end, { fans }),
    redditLinkComparison(range),
    onlyFansMetrics(preset),
    postingVolume(),
  ])

  return (
    <PerformanceView
      preset={preset}
      fans={fans}
      rangeLabel={range.label}
      groups={groups}
      redditLinkCount={links.current.redditLinkCount}
      linkCount={links.current.linkCount}
      redditLinksShort={links.current.redditLinksShort}
      untracedCents={money.untracedCents}
      coverage={money.coverage}
      syncedAt={of.syncedAt ? of.syncedAt.toISOString() : null}
      volume={volume}
    />
  )
}
