'use client'

import * as React from 'react'
import { ArrowLeftRight, ArrowUpRight, Check, Copy, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildPlan, type PlanResult, type PlanSlot } from './actions'
import type { Strategy } from '@/lib/posting/order'

const STRATEGIES: Array<{ value: Strategy; label: string; note: string }> = [
  {
    value: 'members',
    label: 'By size',
    note: 'smallest first, biggest last — the largest subreddits go out every day',
  },
  {
    value: 'ourResults',
    label: 'By our results',
    note: 'ranked on the upvotes we have actually got there, from our own history',
  },
  {
    value: 'traffic',
    label: 'By traffic',
    note: 'members weighed against how many posts a day it takes — where you stay visible',
  },
]

export function Planner({
  accounts,
  niches,
}: {
  accounts: Array<{ id: string; username: string; model: string | null }>
  niches: Array<{ id: string; name: string; color: string | null; count: number }>
}) {
  const [accountId, setAccountId] = React.useState(accounts[0]?.id ?? '')
  const [nicheId, setNicheId] = React.useState(niches[0]?.id ?? '')
  const [slots, setSlots] = React.useState(15)
  const [strategy, setStrategy] = React.useState<Strategy>('members')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [plan, setPlan] = React.useState<PlanResult | null>(null)
  // Which row is being swapped, and the pool it is choosing from. Kept in the
  // client so a swap is instant — the ranking already came back with the plan.
  const [swapping, setSwapping] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [copiedOne, setCopiedOne] = React.useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    const r = await buildPlan({ nicheId, accountId, slots, strategy })
    setBusy(false)
    if (r.ok) {
      setPlan(r)
      setSwapping(null)
    } else {
      setPlan(null)
      setError(r.error)
    }
  }

  /**
   * Put `into` in place of `outOf`, then re-sort. The order rule is the point
   * of the screen, so a swapped-in subreddit takes its rightful place in the
   * run rather than inheriting the position of the one it replaced.
   */
  function swap(outOf: string, into: PlanSlot) {
    if (!plan) return
    const kept = plan.slots.filter((s) => s.subreddit !== outOf)
    const dropped = plan.slots.find((s) => s.subreddit === outOf)!
    const slots = [...kept, into]
      .sort((a, b) => a.rank - b.rank)
      .map((s, i) => ({ ...s, position: i + 1 }))
    setPlan({
      ...plan,
      slots,
      alternatives: [
        ...plan.alternatives.filter((a) => a.subreddit !== into.subreddit),
        dropped,
      ].sort((a, b) => b.rank - a.rank),
    })
    setSwapping(null)
    setFilter('')
  }

  /** Take one out and pull up the best remaining alternative in its place. */
  function drop(outOf: string) {
    if (!plan) return
    const next = plan.alternatives[0]
    if (next) return swap(outOf, next)
    setPlan({
      ...plan,
      slots: plan.slots
        .filter((s) => s.subreddit !== outOf)
        .map((s, i) => ({ ...s, position: i + 1 })),
      alternatives: [...plan.alternatives, plan.slots.find((s) => s.subreddit === outOf)!].sort(
        (a, b) => b.rank - a.rank,
      ),
    })
  }

  function copyOne(name: string) {
    navigator.clipboard.writeText(`r/${name}`)
    setCopiedOne(name)
    setTimeout(() => setCopiedOne(null), 1200)
  }

  function copy() {
    if (!plan) return
    // Plain text, one per line, in order — this gets pasted into whatever the
    // person posting actually works from.
    navigator.clipboard.writeText(
      plan.slots.map((s) => `${s.position}. r/${s.subreddit}`).join('\n'),
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const account = accounts.find((a) => a.id === accountId)

  return (
    <div className="space-y-3">
      <div className="bg-surface border-hairline space-y-3 rounded-[10px] border px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label-xs">Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="bg-surface-2 border-hairline text-14 text-fg mt-1 h-9 w-full rounded-[7px] border px-2 outline-none"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  u/{a.username}
                  {a.model ? ` · ${a.model}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label-xs">Subreddit list</span>
            <select
              value={nicheId}
              onChange={(e) => setNicheId(e.target.value)}
              className="bg-surface-2 border-hairline text-14 text-fg mt-1 h-9 w-full rounded-[7px] border px-2 outline-none"
            >
              {niches.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.count})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label-xs">Posts today</span>
            <input
              type="number"
              min={1}
              max={50}
              value={slots}
              onChange={(e) => setSlots(Number(e.target.value))}
              className="bg-surface-2 border-hairline text-14 text-fg mt-1 h-9 w-full rounded-[7px] border px-2 outline-none"
            />
          </label>
        </div>

        <div>
          <span className="label-xs">Sort by</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {STRATEGIES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStrategy(s.value)}
                className={cn(
                  'rounded-[8px] border px-3 py-2 text-left transition-colors',
                  strategy === s.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline hover:border-fg-muted',
                )}
              >
                <span className="text-14 text-fg block font-medium">{s.label}</span>
                <span className="text-13 text-fg-muted block">{s.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={go}
            disabled={busy || !accountId || !nicheId}
            className="bg-fg text-root text-14 flex h-9 items-center gap-1.5 rounded-[7px] px-4 font-medium disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Build the order
          </button>
          {error && <span className="text-negative text-13">{error}</span>}
        </div>
      </div>

      {plan && (
        <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
          <div className="flex flex-wrap items-baseline gap-x-3 px-4 pt-4 pb-2">
            <span className="text-18 text-fg font-semibold">
              u/{account?.username} · {plan.slots.length} posts
            </span>
            <span className="text-13 text-fg-muted">
              post in this order · {plan.alternatives.length} more in the list to swap from
            </span>
            <button
              type="button"
              onClick={copy}
              className="border-hairline text-13 text-fg-secondary hover:text-fg hover:border-fg-muted ml-auto flex h-7 items-center gap-1.5 rounded-[6px] border px-2.5"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy list'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  {['#', 'Subreddit', 'Members', 'Type', 'Info · rules', ''].map((h, i) => (
                    <th
                      key={h || i}
                      className={cn(
                        'label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap',
                        i === 2 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.slots.map((s) => (
                  <React.Fragment key={s.subreddit}>
                    <tr className="border-hairline hover:bg-surface-2 border-b">
                      <td className="mono tnum text-fg-muted w-8 px-3 py-2 text-right text-14">
                        {s.position}
                      </td>
                      <td className="mono text-15 text-fg px-3 py-2 whitespace-nowrap">
                        r/{s.subreddit}
                      </td>
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {s.subscribers ? compact(s.subscribers) : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <TypeChip nsfw={s.nsfw} sfwOk={s.sfwOk} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {s.rules.map((r) => (
                            <span
                              key={r}
                              className={cn('text-13 rounded-[4px] px-1.5 py-0.5', ruleTone(r))}
                            >
                              {r}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <a
                          href={`https://www.reddit.com/r/${s.subreddit}/`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open r/${s.subreddit}`}
                          className="text-fg-muted hover:text-fg hover:bg-surface-2 inline-flex h-6 w-6 items-center justify-center rounded-[5px]"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => copyOne(s.subreddit)}
                          className="text-fg-muted hover:text-fg text-13 rounded-[5px] px-1.5 py-1"
                        >
                          {copiedOne === s.subreddit ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSwapping(swapping === s.subreddit ? null : s.subreddit)
                            setFilter('')
                          }}
                          aria-label={`Replace r/${s.subreddit}`}
                          className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded-[5px]',
                            swapping === s.subreddit
                              ? 'text-accent bg-accent-soft'
                              : 'text-fg-muted hover:text-fg hover:bg-surface-2',
                          )}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => drop(s.subreddit)}
                          aria-label={`Drop r/${s.subreddit}`}
                          className="text-fg-muted hover:text-negative inline-flex h-6 w-6 items-center justify-center rounded-[5px]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>

                    {swapping === s.subreddit && (
                      <tr className="border-hairline bg-surface-2 border-b">
                        <td colSpan={6} className="px-3 py-2">
                          <input
                            autoFocus
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder={`Replace r/${s.subreddit} with…`}
                            className="bg-surface border-hairline text-13 text-fg mb-2 h-8 w-full rounded-[6px] border px-2 outline-none"
                          />
                          <div className="max-h-56 overflow-y-auto">
                            {plan.alternatives
                              .filter((a) =>
                                a.subreddit.toLowerCase().includes(filter.trim().toLowerCase()),
                              )
                              .slice(0, 40)
                              .map((a) => (
                                <button
                                  key={a.subreddit}
                                  type="button"
                                  onClick={() => swap(s.subreddit, a)}
                                  className="hover:bg-surface flex w-full items-baseline gap-3 rounded-[5px] px-2 py-1.5 text-left"
                                >
                                  <span className="mono text-14 text-fg">r/{a.subreddit}</span>
                                  <span className="mono tnum text-13 text-fg-secondary">
                                    {a.subscribers ? compact(a.subscribers) : '—'}
                                  </span>
                                  <span className="text-13 text-fg-muted ml-auto">
                                    {a.rules.slice(0, 2).join(' · ') || a.note}
                                  </span>
                                </button>
                              ))}
                            {plan.alternatives.length === 0 && (
                              <p className="text-13 text-fg-muted px-2 py-2">
                                Nothing left in the list to swap in.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {(plan.skipped.length > 0 || plan.unmeasured > 0) && (
            <div className="border-hairline text-13 text-fg-muted border-t px-4 py-2.5">
              {plan.skipped.length > 0 && (
                <span>
                  {plan.skipped.length} left out —{' '}
                  {[...new Set(plan.skipped.map((s) => s.why.replace(/\d+/g, 'N')))].join(', ')}
                  .{' '}
                </span>
              )}
              {plan.unmeasured > 0 && (
                <span>{plan.unmeasured} not measured yet, so ranked at the middle.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/**
 * Adult-only, or adult with clothed posts allowed. The second is where a teaser
 * can go, which is a different decision from where a nude can go.
 */
function TypeChip({ nsfw, sfwOk }: { nsfw: boolean | null; sfwOk: boolean }) {
  if (nsfw === null) return <span className="text-fg-muted text-13">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-negative border-negative/40 bg-negative/10 text-13 rounded-[4px] border px-1.5 py-0.5">
        NSFW
      </span>
      {sfwOk && (
        <span className="text-warning border-warning/40 bg-warning/10 text-13 rounded-[4px] border px-1.5 py-0.5">
          SFW ok
        </span>
      )}
    </span>
  )
}

/** Red is what gets an account banned; amber is what gets a post removed. */
function ruleTone(rule: string): string {
  if (/verification|karma|age/.test(rule)) return 'bg-info/15 text-info'
  if (/original content|clickbait|vote/.test(rule)) return 'bg-negative/15 text-negative'
  return 'bg-warning/15 text-warning'
}
