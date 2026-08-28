import { fmtMoney, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CreationVaRow, FarmingVaRow } from '@/lib/queries/va-tracking'

/**
 * The two jobs, tracked on their own clocks.
 *
 * Creation is piece work: counted by the day, paid per account. Farming is
 * counted by the month, because an account takes weeks to warm and a daily
 * target for it would only ever measure impatience.
 *
 * Every figure is derived from the accounts themselves. There is no form behind
 * either table and no session to start.
 */

function Bar({ value, target, good }: { value: number; target: number; good?: boolean }) {
  const pct = target > 0 ? Math.min(1, value / target) : 0
  return (
    <div className="bg-surface-2 ml-auto mt-1 h-1 w-24 overflow-hidden rounded-full">
      <div
        className={cn('h-full rounded-full', good || pct >= 1 ? 'bg-positive' : 'bg-accent')}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  )
}

function Shell({
  title,
  subtitle,
  headers,
  rightFrom,
  empty,
  children,
}: {
  title: string
  subtitle: string
  headers: string[]
  rightFrom: number
  /** shown in place of rows — the section stays put rather than disappearing */
  empty?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
      <div className="border-hairline flex items-baseline justify-between border-b px-4 py-3">
        <h2 className="text-16 text-fg font-semibold">{title}</h2>
        <span className="text-fg-muted text-13">{subtitle}</span>
      </div>
      {empty ? (
        <p className="text-fg-muted text-14 px-4 py-6 text-center">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-2">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      'text-fg-secondary border-hairline h-9 border-b px-4 text-13 font-medium whitespace-nowrap',
                      i >= rightFrom && 'text-right',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function CreationTracking({ rows, dayLabel }: { rows: CreationVaRow[]; dayLabel: string }) {
  const time = (d: Date | null) =>
    d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <Shell
      title="Creation tracking"
      subtitle={dayLabel}
      headers={[
        'Rank',
        'VA',
        'Made today',
        'Daily goal',
        'All time',
        'Flagged',
        'Pay owed',
        'Activity',
      ]}
      rightFrom={2}
      empty={
        rows.length
          ? undefined
          : 'No VA is set up for account creation — give one a pay-per-account rate in Users.'
      }
    >
      {rows.map((r) => (
        <tr key={r.userId} className="border-hairline hover:bg-surface-2 border-b">
          <td className="mono text-14 text-fg-muted px-4 py-3">#{r.rank}</td>
          <td className="text-15 text-fg px-4 py-3 whitespace-nowrap">{r.name}</td>
          <td className="mono text-18 text-fg px-4 py-3 text-right font-semibold tabular-nums">
            {fmtNum(r.madeToday)}
          </td>
          <td className="px-4 py-3 text-right">
            <div className="mono text-14 text-fg tabular-nums">
              {r.madeToday}/{r.goal || '—'}
            </div>
            <Bar value={r.madeToday} target={r.goal} />
          </td>
          <td className="mono text-14 text-fg-secondary px-4 py-3 text-right">
            {fmtNum(r.madeAllTime)}
          </td>
          <td
            className={cn(
              'mono text-14 px-4 py-3 text-right',
              r.flagged > 0 ? 'text-negative' : 'text-fg-muted',
            )}
          >
            {fmtNum(r.flagged)}
          </td>
          <td className="px-4 py-3 text-right">
            <div className="mono text-14 text-fg tabular-nums">{fmtMoney(r.payTodayCents)}</div>
            <div className="text-fg-muted text-13">
              {r.payRateCents ? `${fmtMoney(r.payRateCents)} each` : 'no rate set'}
            </div>
          </td>
          <td className="text-fg-secondary text-13 px-4 py-3 text-right whitespace-nowrap">
            {r.firstAt ? (
              <>
                {time(r.firstAt)} → {time(r.lastAt)}
              </>
            ) : (
              <span className="text-fg-muted">No activity</span>
            )}
          </td>
        </tr>
      ))}
    </Shell>
  )
}

export function FarmingTracking({
  rows,
  monthLabel,
}: {
  rows: FarmingVaRow[]
  monthLabel: string
}) {
  return (
    <Shell
      title="Farming tracking"
      subtitle={monthLabel}
      headers={[
        'Rank',
        'VA',
        'Promoted',
        'Monthly goal',
        'Holding',
        'Ready',
        'Median age',
        'Karma',
        'Flagged',
      ]}
      rightFrom={2}
      empty={
        rows.length
          ? undefined
          : 'No VA is set up for farming — give one a monthly account goal in Users, then assign the accounts they warm.'
      }
    >
      {rows.map((r) => (
        <tr key={r.userId} className="border-hairline hover:bg-surface-2 border-b">
          <td className="mono text-14 text-fg-muted px-4 py-3">#{r.rank}</td>
          <td className="text-15 text-fg px-4 py-3 whitespace-nowrap">{r.name}</td>
          <td className="mono text-18 text-fg px-4 py-3 text-right font-semibold tabular-nums">
            {fmtNum(r.promotedThisMonth)}
          </td>
          <td className="px-4 py-3 text-right">
            <div className="mono text-14 text-fg tabular-nums">
              {r.promotedThisMonth}/{r.monthlyGoal}
            </div>
            <Bar value={r.promotedThisMonth} target={r.monthlyGoal} />
          </td>
          <td className="mono text-14 text-fg px-4 py-3 text-right">{fmtNum(r.farming)}</td>
          <td
            className={cn(
              'mono text-14 px-4 py-3 text-right',
              r.ready > 0 ? 'text-positive' : 'text-fg-muted',
            )}
            title="Old enough to hand to a poster"
          >
            {fmtNum(r.ready)}
          </td>
          <td className="mono text-14 text-fg-secondary px-4 py-3 text-right">
            {r.medianAgeDays == null ? '—' : `${r.medianAgeDays}d`}
          </td>
          <td className="mono text-14 text-fg-secondary px-4 py-3 text-right">{fmtNum(r.karma)}</td>
          <td
            className={cn(
              'mono text-14 px-4 py-3 text-right',
              r.flagged > 0 ? 'text-negative' : 'text-fg-muted',
            )}
          >
            {fmtNum(r.flagged)}
          </td>
        </tr>
      ))}
    </Shell>
  )
}
