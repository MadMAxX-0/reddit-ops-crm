'use client'

import * as React from 'react'
import { ArrowUpRight, Loader2, Plus } from 'lucide-react'
import { fmtCompact, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { createNiche, deleteNiche, removeFromNiche } from './actions'

export interface NicheSub {
  subreddit: string
  subscribers: number | null
  over18: boolean | null
  minKarma: number | null
  minAccountAgeDays: number | null
  requiresVerification: boolean | null
  originalContentOnly: boolean | null
  bansAskingForUpvotes: boolean | null
  rulesRead: boolean
  /// Reddit refuses to serve it — banned, private, or gone. Never a target.
  unavailable: boolean
  /// "any" | "link" | "self" — "link" means a text post is impossible
  submissionType: string | null
  allowsImages: boolean | null
  allowsVideos: boolean | null
  allowsGalleries: boolean | null
  /// the verdict stamped by the splitter — TRANS OK / NO TRANS / NOT STATED —
  /// followed by whatever the source list said
  note: string | null
}

export interface Niche {
  id: string
  name: string
  note: string | null
  color: string | null
  items: NicheSub[]
}

/** A dot per niche, so a niche is recognisable before its name is read. */
const PALETTE = [
  '#FF7A3D',
  '#4D8DFF',
  '#2ECC71',
  '#A78BFA',
  '#F5A623',
  '#FF5C52',
  '#22D3EE',
  '#F472B6',
]

/**
 * Everything a subreddit demands, in one line.
 *
 * The table cannot carry eight columns and stay readable, so the requirements
 * collapse to a sentence — and only facts that were actually READ appear in it.
 * A subreddit whose rules have never been fetched says so, rather than
 * presenting an empty summary as a clean bill of health.
 */
function ruleLine(s: NicheSub): { text: string; tone: 'ok' | 'warn' | 'unread' } {
  if (!s.rulesRead) return { text: 'rules not read', tone: 'unread' }
  const parts: string[] = []
  if (s.requiresVerification === true) parts.push('verif req')
  if (s.minKarma != null || s.minAccountAgeDays != null) {
    const bits = [
      s.minKarma != null ? `${fmtNum(s.minKarma)} karma` : null,
      s.minAccountAgeDays != null ? `${s.minAccountAgeDays}d age` : null,
    ].filter(Boolean)
    parts.push(bits.join(' + '))
  }
  if (s.bansAskingForUpvotes === true) parts.push('no clickbait/begging')
  if (s.originalContentOnly === true) parts.push('no reposts')
  // What the subreddit will physically accept. These are Reddit's own switches
  // rather than someone's prose, so false really does mean no — and "no video"
  // decides how a shoot is delivered, which is worth more than most rules.
  if (s.allowsVideos === false) parts.push('NO VIDEO')
  if (s.allowsImages === false) parts.push('NO IMAGES')
  if (s.allowsGalleries === false) parts.push('no galleries')
  if (s.submissionType === 'link') parts.push('link posts only')
  if (s.submissionType === 'self') parts.push('text posts only')
  return {
    text: parts.length ? parts.join(' · ') : 'no requirements found',
    tone: s.requiresVerification === true ? 'warn' : 'ok',
  }
}

/**
 * The splitter stamps each row with what the subreddit's own rules say about
 * who may post. It leads the note because it is the only line that can get an
 * account banned, and it is coloured by consequence: red bars you, green lets
 * you in, grey means nobody wrote it down — which is not permission.
 */
function Verdict({ note }: { note: string }) {
  const m = /^(TRANS OK|NO TRANS|FEMBOY OK|TRANS NOT STATED|ADDED BY HAND)\s*·\s*([\s\S]*)$/.exec(
    note,
  )
  if (!m) return <span className="text-fg-muted text-13 mt-0.5 block">{note}</span>
  const [, tag, rest] = m
  const tone =
    tag === 'NO TRANS'
      ? 'text-negative border-negative/40 bg-negative/10'
      : tag.endsWith('OK')
        ? 'text-positive border-positive/40 bg-positive/10'
        : 'text-fg-muted border-hairline'
  return (
    <span className="mt-1 block">
      <span className={cn('text-13 mono rounded-[4px] border px-1.5 py-0.5', tone)}>{tag}</span>
      <span className="text-fg-muted text-13 ml-1.5">{rest}</span>
    </span>
  )
}

export function Niches({ niches }: { niches: Niche[] }) {
  const [active, setActive] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [audience, setAudience] = React.useState<'all' | 'sfw' | 'nsfw'>('all')
  // Dead subs stay hidden by default — they are not options — but stay
  // reachable, because "why is r/TransCT not in my list" needs an answer.
  const [showDead, setShowDead] = React.useState(false)
  const [gate, setGate] = React.useState<'all' | 'free' | 'verif'>('all')
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const all = niches.flatMap((n) => n.items)
  // Dead subreddits are excluded from every count. A niche of 33 where 7 cannot
  // be posted in is a niche of 26, and the tiles are what gets read before the
  // list does.
  const live = all.filter((s) => !s.unavailable)
  const totals = {
    subs: new Set(live.map((s) => s.subreddit)).size,
    dead: new Set(all.filter((s) => s.unavailable).map((s) => s.subreddit)).size,
    sfw: live.filter((s) => s.over18 === false).length,
    nsfw: live.filter((s) => s.over18 === true).length,
    free: live.filter((s) => s.requiresVerification !== true && s.rulesRead).length,
    verif: live.filter((s) => s.requiresVerification === true).length,
    reach: live.reduce((a, s) => a + (s.subscribers ?? 0), 0),
  }

  const keep = (s: NicheSub) => {
    if (q && !s.subreddit.toLowerCase().includes(q.toLowerCase())) return false
    if (!showDead && s.unavailable) return false
    if (audience === 'sfw' && s.over18 !== false) return false
    if (audience === 'nsfw' && s.over18 !== true) return false
    if (gate === 'free' && (s.requiresVerification === true || !s.rulesRead)) return false
    if (gate === 'verif' && s.requiresVerification !== true) return false
    return true
  }

  const shown = niches
    .filter((n) => !active || n.id === active)
    .map((n) => ({
      ...n,
      // The rank is the subreddit's place in its niche by member count, fixed
      // before any filter runs. A rank that renumbers when you tick "NSFW" is
      // not a rank, it is a row number.
      items: n.items.map((s, idx) => ({ ...s, rank: s.unavailable ? null : idx + 1 })).filter(keep),
    }))
    .filter((n) => n.items.length > 0 || !q)

  const rowCount = shown.reduce((a, n) => a + n.items.length, 0)

  async function submit() {
    setBusy(true)
    setError(null)
    const r = await createNiche(name, PALETTE[niches.length % PALETTE.length])
    setBusy(false)
    if (r.ok) {
      setName('')
      setAdding(false)
    } else setError(r.error ?? 'Could not create it.')
  }

  return (
    <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4 pb-3">
        <span className="text-18 text-fg font-semibold">Niches</span>
        <span className="text-fg-muted text-13">
          {fmtNum(totals.subs)} live subreddits · {fmtCompact(totals.reach)} combined reach ·{' '}
          {niches.length} niche{niches.length === 1 ? '' : 's'}
          {totals.dead > 0 && <span className="text-negative"> · {totals.dead} dead</span>}
        </span>
      </div>

      {/* tiles: the count is the point, so it leads */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:grid-cols-4 xl:grid-cols-6">
        <Tile
          n={totals.subs}
          label="All"
          on={active === null}
          onClick={() => setActive(null)}
          color={null}
        />
        {niches.map((n, i) => (
          <Tile
            key={n.id}
            n={n.items.filter((it) => !it.unavailable).length}
            label={n.name}
            color={n.color ?? PALETTE[i % PALETTE.length]}
            on={active === n.id}
            onClick={() => setActive(active === n.id ? null : n.id)}
          />
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="border-hairline text-fg-muted hover:text-fg hover:border-fg-muted flex min-h-[72px] flex-col items-center justify-center rounded-[10px] border border-dashed text-14 transition-colors"
        >
          <Plus className="mb-1 h-3.5 w-3.5" />
          Niche
        </button>
      </div>

      {adding && (
        <div className="border-hairline bg-surface-2 flex flex-wrap items-center gap-2 border-y px-4 py-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()}
            placeholder="Niche name — e.g. Trans, Latina, Goth"
            className="bg-surface border-hairline text-14 text-fg h-8 min-w-56 flex-1 rounded-[6px] border px-2 outline-none"
          />
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={submit}
            className="bg-fg text-root text-14 h-8 rounded-[6px] px-3 font-medium disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
          </button>
          {error && <span className="text-negative text-13">{error}</span>}
        </div>
      )}

      {/* filter bar */}
      <div className="border-hairline flex flex-wrap items-center gap-2 border-y px-4 py-2.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter subreddits…"
          className="bg-surface-2 border-hairline text-14 text-fg h-8 min-w-48 flex-1 rounded-[7px] border px-2.5 outline-none"
        />
        <Chip
          label="SFW"
          n={totals.sfw}
          on={audience === 'sfw'}
          onClick={() => setAudience(audience === 'sfw' ? 'all' : 'sfw')}
        />
        <Chip
          label="NSFW"
          n={totals.nsfw}
          on={audience === 'nsfw'}
          onClick={() => setAudience(audience === 'nsfw' ? 'all' : 'nsfw')}
        />
        <Chip
          label="Free to post"
          n={totals.free}
          on={gate === 'free'}
          onClick={() => setGate(gate === 'free' ? 'all' : 'free')}
        />
        <Chip
          label="Req verif"
          n={totals.verif}
          on={gate === 'verif'}
          onClick={() => setGate(gate === 'verif' ? 'all' : 'verif')}
        />
        {totals.dead > 0 && (
          <Chip label="Dead" n={totals.dead} on={showDead} onClick={() => setShowDead((v) => !v)} />
        )}
        <span className="text-fg-muted ml-auto text-13">
          {shown.length} niche{shown.length === 1 ? '' : 's'} · {fmtNum(rowCount)} rows
        </span>
      </div>

      {totals.subs === 0 ? (
        <p className="text-14 text-fg-muted px-4 py-10 text-center">
          No subreddits filed yet. Make a niche, then select rows in Discovered subreddits above and
          add them to it.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-2">
              <tr>
                {['', 'Subreddit', 'Members', 'Type', 'Info · rules', ''].map((h, i) => (
                  <th
                    key={i}
                    className="label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((n, ni) => (
                <React.Fragment key={n.id}>
                  <tr className="bg-surface-2/60">
                    <td colSpan={6} className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: n.color ?? PALETTE[ni % PALETTE.length] }}
                        />
                        <span className="text-15 text-fg font-medium">{n.name}</span>
                        <span className="text-fg-muted text-13">
                          {n.items.length} sub{n.items.length === 1 ? '' : 's'}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteNiche(n.id)}
                          className="text-fg-muted hover:text-negative ml-auto text-13"
                        >
                          Delete niche
                        </button>
                      </span>
                    </td>
                  </tr>
                  {n.items.map((s) => {
                    const rule = ruleLine(s)
                    return (
                      <tr
                        key={s.subreddit}
                        className={cn(
                          'border-hairline hover:bg-surface-2 border-b',
                          s.unavailable && 'opacity-45',
                        )}
                      >
                        <td className="mono text-13 text-fg-muted w-8 px-3 py-2 text-right">
                          {s.rank ?? '—'}
                        </td>
                        <td className="mono text-14 text-fg px-3 py-2 whitespace-nowrap">
                          <span className={cn(s.unavailable && 'line-through')}>
                            r/{s.subreddit}
                          </span>
                          {s.unavailable && (
                            <span className="text-negative text-13 mono border-negative/40 bg-negative/10 ml-2 rounded-[4px] border px-1.5 py-0.5 no-underline">
                              DEAD
                            </span>
                          )}
                        </td>
                        <td className="mono text-14 text-fg tnum px-3 py-2 text-right font-medium">
                          {s.subscribers == null ? '—' : fmtCompact(s.subscribers)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              'text-13 mono rounded-[4px] border px-1.5 py-0.5',
                              s.over18 === true
                                ? 'text-negative border-negative/40 bg-negative/10'
                                : s.over18 === false
                                  ? 'text-fg-muted border-hairline'
                                  : 'text-fg-muted border-hairline opacity-60',
                            )}
                          >
                            {s.over18 == null ? '?' : s.over18 ? 'NSFW' : 'SFW'}
                          </span>
                        </td>
                        <td
                          className={cn(
                            'text-13 px-3 py-2',
                            rule.tone === 'warn' && 'text-warning',
                            rule.tone === 'ok' && 'text-fg-secondary',
                            rule.tone === 'unread' && 'text-fg-muted italic',
                          )}
                        >
                          {rule.text}
                          {s.note && <Verdict note={s.note} />}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center justify-end gap-1">
                            <a
                              href={`https://www.reddit.com/r/${s.subreddit}/`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open r/${s.subreddit}`}
                              className="text-fg-muted hover:text-fg hover:bg-surface-2 flex h-6 w-6 items-center justify-center rounded-[5px]"
                            >
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                navigator.clipboard?.writeText(`r/${s.subreddit}`).catch(() => {})
                              }
                              className="text-fg-muted hover:text-fg hover:bg-surface-2 text-13 h-6 rounded-[5px] px-2"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromNiche(n.id, s.subreddit)}
                              className="text-fg-muted hover:text-negative text-13 h-6 rounded-[5px] px-2"
                            >
                              Remove
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({
  n,
  label,
  color,
  on,
  onClick,
}: {
  n: number
  label: string
  color: string | null
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'bg-surface-2 flex min-h-[72px] flex-col justify-center rounded-[10px] border px-3 py-2.5 text-left transition-colors',
        on ? 'border-fg' : 'border-hairline hover:border-fg-muted',
      )}
    >
      <span className="mono text-24 text-fg font-semibold tracking-tight">{fmtNum(n)}</span>
      <span className="text-fg-muted mt-0.5 flex items-center gap-1.5 text-13 uppercase">
        {color && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        )}
        <span className="truncate">{label}</span>
      </span>
    </button>
  )
}

function Chip({
  label,
  n,
  on,
  onClick,
}: {
  label: string
  n: number
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-13 inline-flex h-8 items-center gap-1.5 rounded-[7px] border px-2.5 transition-colors',
        on
          ? 'border-fg bg-surface-2 text-fg'
          : 'border-hairline bg-surface-2 text-fg-secondary hover:text-fg',
      )}
    >
      {label}
      <span className="mono text-fg-muted">{fmtNum(n)}</span>
    </button>
  )
}
