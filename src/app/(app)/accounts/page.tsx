import { requireCtx } from '@/lib/session'
import { activeRoster } from '@/lib/queries/active-roster'
import { listOfLinks } from '@/lib/queries/of-links'
import { resolveRange } from '@/lib/time'
import { getAccountDetail } from '@/lib/queries/account-detail'
import { todayKey, dayContextLine } from '@/lib/time'
import { PageHeader, TabRow } from '@/components/shell/page-header'
import { TabLink } from '@/components/shell/tab-link'
import { Roster } from './roster'
import { DeepLinksPanel } from './deep-links-panel'
import { AccountDrawer } from './account-drawer'

export const metadata = { title: 'Account Tracker · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

/**
 * The accounts in rotation, grouped by the VA who works them.
 *
 * The flat "full account database" that used to live here was removed on
 * 2026-08-26: it listed all 71 accounts with no notion of which were working,
 * so the 61 that are being created or farmed sat beside the 10 doing the job
 * and the screen answered "what do we own" instead of "what is working". The
 * pipeline screen already answers the first question properly. The old page is
 * kept beside this one as `_full-database-page.tsx.bak` — a leading underscore
 * makes the folder invisible to the router, so it is not routed and not built.
 *
 * The drawer stays: every account name here opens it.
 */
export default async function AccountsPage(props: PageProps<'/accounts'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const openAccountId = one(sp.account)

  // Deep links are read here rather than on their own screen. The tick that
  // decides what counts as Reddit revenue is set once and rarely revisited, so
  // it lives folded under the accounts it belongs to.
  const range = resolveRange('30d', ctx.workspace.dayBoundaryTimezone)
  const [{ groups, totals }, detail, allLinks] = await Promise.all([
    activeRoster(),
    openAccountId ? getAccountDetail(ctx, openAccountId) : Promise.resolve(null),
    listOfLinks(range.start, range.end),
  ])
  // an un-ticked link stays listed, or it could never be ticked back on
  const links = allLinks.filter((l) => l.classifiedReddit || l.trackedInCrm)

  return (
    <>
      <PageHeader
        title="Account Tracker"
        context={`${dayContextLine(todayKey(ctx.workspace.dayBoundaryTimezone), ctx.workspace.dayBoundaryTimezone, ctx.user.timezone)} · accounts in rotation, grouped by the VA who works them`}
        tabs={
          <TabRow>
            <TabLink href="/accounts">In rotation</TabLink>
            <TabLink href="/pipeline">Pipeline</TabLink>
          </TabRow>
        }
      />

      <Roster
        totals={totals}
        groups={groups.map((g) => ({
          ...g,
          accounts: g.accounts.map((a) => ({
            ...a,
            // Dates cannot cross into a client component
            lastPostAt: a.lastPostAt ? a.lastPostAt.toISOString() : null,
            best: a.best.map((p) => ({ ...p, postedAt: p.postedAt.toISOString() })),
            latest: a.latest.map((p) => ({ ...p, postedAt: p.postedAt.toISOString() })),
          })),
        }))}
      />

      <DeepLinksPanel
        rows={links}
        rangeLabel={range.label}
        canEdit={ctx.isManager}
        defaultOpen={one(sp.links) === '1'}
      />

      {detail && (
        <AccountDrawer detail={detail} displayTz={ctx.user.timezone} canMutate={ctx.isManager} />
      )}
    </>
  )
}
