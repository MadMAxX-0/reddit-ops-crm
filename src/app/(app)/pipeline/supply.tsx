import { fmtCompact, fmtNum } from '@/lib/format'
import type { PipelineSummary } from '@/lib/queries/va-tracking'
import { cn } from '@/lib/utils'

/**
 * The state of the account supply, above the VA tracking that produces it.
 *
 * Four numbers rather than a table, because this is the question asked from the
 * doorway — is there stock, is it usable, is it burning — and an answer that
 * needs reading is not an answer to that question.
 */
/**
 * Statuses are listed from what is actually in the table, never from a guessed
 * pair. The first version of this said "suspended or retired" when not one
 * account has ever been retired — a category invented by the label.
 */
export function Supply({ s }: { s: PipelineSummary }) {
  const breakdown = s.byStatus.map((x) => `${fmtNum(x.n)} ${x.status.toLowerCase()}`).join(' · ')
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Accounts" value={fmtNum(s.accounts)} note={breakdown} />
      <Tile
        label="Ready to use"
        value={fmtNum(s.ready)}
        note={`${s.readyAgeDays}+ days old and ${fmtCompact(s.readyKarma)}+ karma`}
        tone={s.ready === 0 ? 'warn' : 'good'}
      />
      <Tile
        label="Total karma"
        value={fmtNum(s.karma)}
        note="across every account, post and comment"
      />
      <Tile
        label={`Bans found · ${s.banWindowDays}d`}
        value={fmtNum(s.bannedRecently)}
        note={
          s.bansUndated > 0
            ? `when the check noticed, not when Reddit acted · ${fmtNum(s.bansUndated)} undated`
            : 'when the check noticed, not when Reddit acted'
        }
        tone={s.bannedRecently > 0 ? 'bad' : 'good'}
      />
    </div>
  )
}

function Tile({
  label,
  value,
  note,
  tone = 'plain',
}: {
  label: string
  value: string
  note: string
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div className="bg-surface border-hairline flex flex-col gap-1.5 rounded-[10px] border px-5 py-4">
      <span className="text-14 text-fg-muted">{label}</span>
      <span
        className={cn(
          'kpi',
          tone === 'good' && 'text-positive',
          tone === 'warn' && 'text-warning',
          tone === 'bad' && 'text-negative',
          tone === 'plain' && 'text-fg',
        )}
      >
        {value}
      </span>
      <span className="text-13 text-fg-muted leading-snug">{note}</span>
    </div>
  )
}
