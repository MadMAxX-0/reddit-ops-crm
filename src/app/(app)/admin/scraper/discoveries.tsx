'use client'

import * as React from 'react'
import { Check, Loader2, Minus, X } from 'lucide-react'
import { fmtCompact, fmtNum } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { addToNiche, dismissSubreddit, promoteSubreddit } from './actions'

export interface Discovery {
  name: string
  subscribers: number | null
  over18: boolean
  posts: number
  targets: number
  bestScore: number
  avgScore: number
  promoted: boolean
  dismissed: boolean
  minKarma: number | null
  minAccountAgeDays: number | null
  requiresVerification: boolean | null
  originalContentOnly: boolean | null
  bansAskingForUpvotes: boolean | null
  ruleCount: number | null
  rulesCheckedAt: string | null
}

/**
 * A tri-state cell. `true` is what the rules say, `null` is what they did not
 * say — and the two are drawn differently on purpose. A blank cell is "we have
 * not read that", never "no", because a rule nobody wrote down is a rule that
 * can still get an account banned.
 */
function Tri({ v, good }: { v: boolean | null; good: boolean }) {
  if (v == null) return <Minus className="text-fg-muted/50 mx-auto h-3 w-3" />
  return v ? (
    <Check className={cn('mx-auto h-3.5 w-3.5', good ? 'text-positive' : 'text-warning')} />
  ) : (
    <X className="text-fg-muted mx-auto h-3.5 w-3.5" />
  )
}

type Filters = {
  nsfw: 'any' | 'nsfw' | 'sfw'
  verification: 'any' | 'none' | 'required'
  karma: 'any' | 'none' | 'under100' | 'under500'
  oc: 'any' | 'required'
  hideDismissed: boolean
  hidePromoted: boolean
}

const EMPTY: Filters = {
  nsfw: 'any',
  verification: 'any',
  karma: 'any',
  oc: 'any',
  hideDismissed: true,
  hidePromoted: false,
}

export function Discoveries({
  rows,
  niches,
}: {
  rows: Discovery[]
  niches: { id: string; name: string }[]
}) {
  const [f, setF] = React.useState<Filters>(EMPTY)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  const shown = rows.filter((r) => {
    if (f.hideDismissed && r.dismissed) return false
    if (f.hidePromoted && r.promoted) return false
    if (f.nsfw === 'nsfw' && !r.over18) return false
    if (f.nsfw === 'sfw' && r.over18) return false
    if (f.verification === 'none' && r.requiresVerification === true) return false
    if (f.verification === 'required' && r.requiresVerification !== true) return false
    if (f.karma === 'none' && r.minKarma != null) return false
    if (f.karma === 'under100' && (r.minKarma ?? 0) > 100) return false
    if (f.karma === 'under500' && (r.minKarma ?? 0) > 500) return false
    if (f.oc === 'required' && r.originalContentOnly !== true) return false
    return true
  })

  const toggle = (name: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const allShown = shown.length > 0 && shown.every((r) => picked.has(r.name))
  const names = [...picked]

  async function run(fn: () => Promise<{ ok: boolean; error?: string; count?: number }>) {
    setBusy(true)
    setMsg(null)
    const r = await fn()
    setBusy(false)
    setMsg(r.ok ? `Done${r.count != null ? ` · ${r.count}` : ''}` : (r.error ?? 'Failed'))
    if (r.ok) setPicked(new Set())
  }

  return (
    <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
      <div className="border-hairline flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <span className="text-15 text-fg font-medium">Discovered subreddits</span>
        <span className="text-fg-muted text-13">
          {fmtNum(shown.length)} of {fmtNum(rows.length)} · what each one demands, read from its own
          rules
        </span>
      </div>

      {/* filters — the questions the team actually asks before choosing a sub */}
      <div className="border-hairline flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
        <Pick
          label="Audience"
          value={f.nsfw}
          onChange={(v) => setF({ ...f, nsfw: v as Filters['nsfw'] })}
          options={[
            ['any', 'Any'],
            ['nsfw', 'NSFW'],
            ['sfw', 'SFW'],
          ]}
        />
        <Pick
          label="Verification"
          value={f.verification}
          onChange={(v) => setF({ ...f, verification: v as Filters['verification'] })}
          options={[
            ['any', 'Any'],
            ['none', 'Not required'],
            ['required', 'Required'],
          ]}
        />
        <Pick
          label="Karma"
          value={f.karma}
          onChange={(v) => setF({ ...f, karma: v as Filters['karma'] })}
          options={[
            ['any', 'Any'],
            ['none', 'No floor'],
            ['under100', '≤ 100'],
            ['under500', '≤ 500'],
          ]}
        />
        <Pick
          label="Content"
          value={f.oc}
          onChange={(v) => setF({ ...f, oc: v as Filters['oc'] })}
          options={[
            ['any', 'Any'],
            ['required', 'Original only'],
          ]}
        />
        <label className="text-13 text-fg-secondary ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={f.hideDismissed}
            onChange={(e) => setF({ ...f, hideDismissed: e.target.checked })}
          />
          Hide dismissed
        </label>
        <label className="text-13 text-fg-secondary flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={f.hidePromoted}
            onChange={(e) => setF({ ...f, hidePromoted: e.target.checked })}
          />
          Hide promoted
        </label>
      </div>

      {picked.size > 0 && (
        <div className="border-hairline bg-surface-2 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <span className="text-14 text-fg">{picked.size} selected</span>
          {niches.length > 0 && (
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value
                e.target.value = ''
                if (id) void run(() => addToNiche(id, names))
              }}
              className="bg-surface border-hairline text-14 text-fg h-7 rounded-[6px] border px-2"
            >
              <option value="">Add to niche…</option>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" disabled={busy} onClick={() => run(() => promoteSubreddit(names))}>
            Promote
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => dismissSubreddit(names))}
          >
            Dismiss
          </Button>
          {busy && <Loader2 className="text-fg-muted h-3.5 w-3.5 animate-spin" />}
          {msg && <span className="text-13 text-fg-muted">{msg}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-2">
            <tr>
              <th className="border-hairline h-9 w-8 border-b px-3">
                <input
                  type="checkbox"
                  checked={allShown}
                  onChange={() =>
                    setPicked(allShown ? new Set() : new Set(shown.map((r) => r.name)))
                  }
                  aria-label="Select all shown"
                />
              </th>
              {[
                'Subreddit',
                'Members',
                'Seen',
                'Best',
                'Karma',
                'Age',
                'Verif',
                'OC only',
                'No bait',
                'Rules',
              ].map((h) => (
                <th
                  key={h}
                  className="label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.name}
                className={cn(
                  'border-hairline hover:bg-surface-2 border-b',
                  r.dismissed && 'opacity-45',
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={picked.has(r.name)}
                    onChange={() => toggle(r.name)}
                    aria-label={`Select r/${r.name}`}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <a
                    href={`https://www.reddit.com/r/${r.name}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-14 text-fg hover:text-accent"
                  >
                    r/{r.name}
                  </a>
                  {r.over18 && <span className="text-negative ml-1.5 text-13">18+</span>}
                  {r.promoted && <span className="text-positive ml-1.5 text-13">in list</span>}
                </td>
                <td className="mono text-14 text-fg-secondary px-3 py-2 text-right">
                  {r.subscribers == null ? '—' : fmtCompact(r.subscribers)}
                </td>
                <td className="mono text-14 text-fg-secondary px-3 py-2 text-right">
                  {r.targets}×
                </td>
                <td className="mono text-14 text-fg-secondary px-3 py-2 text-right">
                  {fmtNum(r.bestScore)}
                </td>
                <td className="mono text-14 px-3 py-2 text-right">
                  {r.minKarma == null ? (
                    <span className="text-fg-muted">—</span>
                  ) : (
                    <span className="text-warning">{fmtNum(r.minKarma)}</span>
                  )}
                </td>
                <td className="mono text-14 px-3 py-2 text-right">
                  {r.minAccountAgeDays == null ? (
                    <span className="text-fg-muted">—</span>
                  ) : (
                    <span className="text-warning">{r.minAccountAgeDays}d</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Tri v={r.requiresVerification} good={false} />
                </td>
                <td className="px-3 py-2">
                  <Tri v={r.originalContentOnly} good={false} />
                </td>
                <td className="px-3 py-2">
                  <Tri v={r.bansAskingForUpvotes} good={false} />
                </td>
                <td className="mono text-13 text-fg-muted px-3 py-2 text-right">
                  {r.rulesCheckedAt ? (r.ruleCount ?? 0) : 'unread'}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={11} className="text-14 text-fg-muted px-4 py-8 text-center">
                  Nothing matches those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-fg-muted text-13 border-hairline border-t px-4 py-2.5 leading-relaxed">
        A dash means the rules do not say, not that the answer is no — an unread rule can still get
        an account banned. Every judgement is read from the subreddit&rsquo;s own rule text, so
        check anything that looks wrong against the sub itself.
      </p>
    </div>
  )
}

function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label className="bg-surface-2 border-hairline text-13 text-fg-muted flex items-center gap-1.5 rounded-[6px] border px-2 py-1">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-13 text-fg cursor-pointer bg-transparent outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} className="bg-surface text-fg">
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}
