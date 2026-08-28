'use client'

import { useFilterNav } from '@/components/filters/use-filter-nav'
import { PageHeader } from '@/components/shell/page-header'
import { PostingVolume, type AccountVolume, type VolumeCell } from './posting-volume'
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AccountPerformance, type Group } from '@/app/(app)/dashboard/account-performance'

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
] as const

const FANS = [
  { value: 'all', label: 'All fans' },
  { value: 'new', label: 'New fans' },
  { value: 'returning', label: 'Returning' },
] as const

export function PerformanceView({
  preset,
  fans,
  rangeLabel,
  groups,
  redditLinkCount,
  linkCount,
  redditLinksShort,
  untracedCents,
  coverage,
  syncedAt,
  volume,
}: {
  preset: string
  fans: string
  rangeLabel: string
  groups: Group[]
  redditLinkCount: number
  linkCount: number
  redditLinksShort: number
  untracedCents: number
  coverage: number | null
  syncedAt: string | null
  volume: {
    total: Record<'24h' | '7d' | '30d', VolumeCell>
    accounts: AccountVolume[]
    activeInWindow: number
    accountsTotal: number
  }
}) {
  const { set } = useFilterNav()

  return (
    <>
      <PageHeader
        title="Performance"
        context="Every account in rotation, grouped by the VA who works it — the account is the unit, because a VA total hides the one that went quiet"
        filters={
          <div className="flex flex-wrap items-center gap-2">
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
                  onClick={() => set({ fans: f.value })}
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
          </div>
        }
      />

      {/* Volume sits above the VA breakdown: how much went out and how much
          survived is the state of play; who did it is the next question. */}
      <div className="mb-4">
        <PostingVolume
          total={volume.total}
          accounts={volume.accounts}
          activeInWindow={volume.activeInWindow}
          accountsTotal={volume.accountsTotal}
        />
      </div>

      <AccountPerformance groups={groups} rangeLabel={rangeLabel} />

      <div className="text-fg-muted text-13 mt-4 space-y-1 leading-relaxed">
        <p>
          Clicks, subs and revenue are Reddit only — counted from the {fmtNum(redditLinkCount)}{' '}
          OnlyFans tracking links the Reddit bios use, out of {fmtNum(linkCount)} links in the
          panel. Instagram, Twitter and DM traffic is excluded.
          {syncedAt && ` Last synced ${new Date(syncedAt).toLocaleString('en-GB')}.`}
        </p>
        <p>
          Revenue is traced payment by payment: OnlyFans records which link each fan came through,
          and every payment against the fan who made it. Nothing is apportioned, and a fan Reddit
          brought in long ago still counts as Reddit&rsquo;s the day they spend.
        </p>
        <p>
          {redditLinksShort === 0 ? (
            <>
              All {fmtNum(redditLinkCount)} Reddit links have had their full fan lists walked, so
              the Reddit figure is complete.
            </>
          ) : (
            <span className="text-warning">
              {redditLinksShort} Reddit {redditLinksShort === 1 ? 'link has' : 'links have'} an
              incomplete fan list, so Reddit is undercounted here — run `npm run of:claims:walk`.
            </span>
          )}{' '}
          {coverage != null && (
            <>
              Across all sources {fmtPct(coverage, 0)} of this period&rsquo;s money traces to a
              link; the other {fmtMoney(untracedCents)} is from fans who arrived through no link at
              all, or through a non-Reddit link whose list has not been walked.
            </>
          )}
        </p>
      </div>
    </>
  )
}
