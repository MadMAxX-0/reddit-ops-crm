'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronRight, ImageOff } from 'lucide-react'
import { fmtNum, fmtCompact } from '@/lib/format'

import { cn } from '@/lib/utils'

type Window = '24h' | '7d' | '30d'

export interface WindowCell {
  posts: number
  live: number
  byMod: number
  byReddit: number
  byAuthor: number
  unknown: number
  upvotes: number
  comments: number
  commentsMade: number
  commentKarma: number
  avgUpvotes: number
  clicks: number
  subs: number
}

export interface RosterPost {
  id: string
  subreddit: string
  title: string
  url: string | null
  thumbnailUrl: string | null
  mediaUrl: string | null
  score: number
  comments: number
  postedAt: string
  status: string
  removedBy: string | null
}

export interface RosterAccount {
  id: string
  username: string
  status: string
  flag: string | null
  model: string | null
  karmaPost: number
  karmaComment: number
  ageDays: number | null
  lastPostAt: string | null
  suspectedMissedPosts: number
  best: RosterPost[]
  latest: RosterPost[]
  windows: Record<Window, WindowCell>
}

export interface RosterGroup {
  vaId: string
  vaName: string
  accounts: RosterAccount[]
  windows: Record<
    Window,
    {
      posts: number
      live: number
      clicks: number
      subs: number
      upvotes: number
      commentsMade: number
      survival: number | null
    }
  >
  dead: number
}

/**
 * The accounts in rotation, grouped by the VA who works them.
 *
 * Every column answers a question someone actually asks: is this account alive,
 * is it posting, is what it posts surviving, and is any of it reaching anyone.
 * The removal split stays split — mods rejecting a post and Reddit filtering it
 * are different problems with different fixes.
 */

/**
 * Hours until 48, then days.
 *
 * The shared relative formatter rounds anything under two days to "1d", so an
 * account whose last post was 25 hours ago sat beside a 24-hour window reading
 * zero posts and the row looked broken. It was not — 25h is outside a 24h
 * window — but a reader cannot tell that from "1d". At this granularity the
 * hour is the number that decides whether a gap matters.
 */
function sinceLabel(iso: string | null): string {
  if (!iso) return 'never'
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return 'just now'
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

export function Roster({
  groups,
  totals,
}: {
  groups: RosterGroup[]
  totals: {
    accounts: number
    dead: number
    windows: Record<Window, { posts: number; live: number; clicks: number; subs: number }>
  }
}) {
  const [win, setWin] = React.useState<Window>('7d')
  const [open, setOpen] = React.useState<string | null>(null)

  return (
    <div className="space-y-3">
      <div className="bg-surface border-hairline flex flex-wrap items-center gap-2 rounded-[10px] border px-4 py-2.5">
        <span className="label-xs">Showing</span>
        {(['24h', '7d', '30d'] as Window[]).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWin(w)}
            className={cn(
              'text-14 rounded-md border px-2.5 py-1 transition-colors',
              win === w
                ? 'border-accent text-accent bg-accent-soft'
                : 'border-hairline text-fg-muted hover:text-fg',
            )}
          >
            {w}
          </button>
        ))}
        <span className="text-fg-muted ml-auto text-13">
          Every number in the table describes the selected window
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Accounts in rotation" value={fmtNum(totals.accounts)} />
        <Tile
          label="Suspended"
          value={fmtNum(totals.dead)}
          tone={totals.dead ? 'bad' : 'plain'}
          note="account is gone — not recoverable"
        />
        <Tile
          label={`Posts · ${win}`}
          value={fmtNum(totals.windows[win].posts)}
          note={`${fmtNum(totals.windows[win].live)} still live`}
        />
        <Tile
          label={`Clicks · ${win}`}
          value={fmtCompact(totals.windows[win].clicks)}
          note={`${fmtNum(totals.windows[win].subs)} fans arrived`}
        />
      </div>

      {groups.map((g) => (
        <div
          key={g.vaId}
          className="bg-surface border-hairline overflow-hidden rounded-[10px] border"
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pt-4 pb-3">
            <span className="text-18 text-fg font-semibold">{g.vaName}</span>
            <span className="text-13 text-fg-muted">
              {g.accounts.length} account{g.accounts.length === 1 ? '' : 's'}
              {g.dead > 0 && <span className="text-negative"> · {g.dead} suspended</span>}
            </span>
            <span className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <HeadStat label="Posts" value={fmtNum(g.windows[win].posts)} />
              <HeadStat
                label="Survived"
                value={
                  g.windows[win].survival == null
                    ? '\u2014'
                    : `${Math.round(g.windows[win].survival! * 100)}%`
                }
                tone={
                  g.windows[win].survival != null && g.windows[win].survival! < 0.6
                    ? 'bad'
                    : 'plain'
                }
              />
              <HeadStat label="Upvotes" value={fmtCompact(g.windows[win].upvotes)} />
              <HeadStat label="Clicks" value={fmtCompact(g.windows[win].clicks)} />
              <HeadStat label="Comments left" value={fmtNum(g.windows[win].commentsMade)} />
              <HeadStat label="Fans" value={fmtNum(g.windows[win].subs)} />
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  {[
                    'Account',
                    'Model',
                    'State',
                    'Karma',
                    'Age',
                    'Posts',
                    'Live',
                    'Mods',
                    'Reddit',
                    'Avg ↑',
                    'Replies',
                    'Comments left',
                    'Clicks',
                    'Fans',
                    'Last post',
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap',
                        i > 2 && i < 14 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.accounts.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr className="border-hairline hover:bg-surface-2 border-b">
                      <td className="mono text-14 px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOpen(open === a.id ? null : a.id)}
                            aria-label={`Show posts for u/${a.username}`}
                            className="text-fg-muted hover:text-fg flex h-5 w-5 items-center justify-center rounded-[4px]"
                          >
                            <ChevronRight
                              className={cn(
                                'h-3.5 w-3.5 transition-transform',
                                open === a.id && 'rotate-90',
                              )}
                            />
                          </button>
                          <Link
                            href={`/accounts?account=${a.id}`}
                            className="text-fg hover:text-accent"
                          >
                            u/{a.username}
                          </Link>
                          {/* Straight to the profile on Reddit. The CRM answers
                            what the numbers say; only the real page answers
                            whether the account still looks right. */}
                          <a
                            href={`https://www.reddit.com/user/${a.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open u/${a.username} on Reddit`}
                            aria-label={`Open u/${a.username} on Reddit`}
                            className="text-fg-muted hover:text-fg hover:bg-surface-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px]"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        </span>
                      </td>
                      <td className="text-14 text-fg-secondary px-3 py-2 whitespace-nowrap">
                        {a.model ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <State status={a.status} />
                      </td>
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {fmtNum(a.karmaPost + a.karmaComment)}
                      </td>
                      <td className="mono tnum text-fg-muted px-3 py-2 text-right text-14">
                        {a.ageDays == null ? '—' : `${a.ageDays}d`}
                      </td>
                      <td className="mono tnum text-fg px-3 py-2 text-right text-14 font-medium">
                        {a.windows[win].posts || '—'}
                      </td>
                      <Num v={a.windows[win].live} tone="positive" />
                      <Num v={a.windows[win].byMod} tone="warning" />
                      <Num v={a.windows[win].byReddit} tone="negative" />
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {a.windows[win].avgUpvotes || '—'}
                      </td>
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {a.windows[win].comments || '—'}
                      </td>
                      {/* Comments this account LEFT. For a warming account this is
                        the entire job, and it was invisible until now. */}
                      <td
                        className={cn(
                          'mono tnum px-3 py-2 text-right text-14',
                          a.windows[win].commentsMade ? 'text-info' : 'text-fg-muted',
                        )}
                        title={
                          a.windows[win].commentsMade
                            ? `${a.windows[win].commentKarma} comment karma earned`
                            : undefined
                        }
                      >
                        {a.windows[win].commentsMade || '—'}
                      </td>
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {a.windows[win].clicks ? fmtCompact(a.windows[win].clicks) : '—'}
                      </td>
                      <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                        {a.windows[win].subs || '—'}
                      </td>
                      <td className="text-13 text-fg-muted px-3 py-2 whitespace-nowrap">
                        {sinceLabel(a.lastPostAt)}
                      </td>
                    </tr>
                    {open === a.id && (
                      <tr className="border-hairline border-b">
                        <td colSpan={14} className="p-0">
                          <PostList best={a.best} latest={a.latest} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
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
  note?: string
  tone?: 'plain' | 'bad'
}) {
  return (
    <div className="bg-surface border-hairline rounded-[10px] border px-5 py-4">
      <div className="text-14 text-fg-muted">{label}</div>
      <div className={cn('kpi', tone === 'bad' && 'text-negative')}>{value}</div>
      {note && <div className="text-13 text-fg-muted mt-1">{note}</div>}
    </div>
  )
}

function HeadStat({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'bad'
}) {
  return (
    <span className="inline-flex flex-col">
      <span className="label-xs">{label}</span>
      <span
        className={cn(
          'mono tnum text-16 font-medium',
          tone === 'bad' ? 'text-negative' : 'text-fg',
        )}
      >
        {value}
      </span>
    </span>
  )
}

/**
 * An account's own posts. Best ever answers "what works for this account" —
 * which subreddit, which kind of title — and Latest answers "what is it doing
 * now". Two lists rather than one sorted two ways, because the biggest post an
 * account ever made is usually months old.
 */
function PostList({ best, latest }: { best: RosterPost[]; latest: RosterPost[] }) {
  const [order, setOrder] = React.useState<'latest' | 'best'>('best')
  const shown = order === 'best' ? best : latest

  return (
    <div className="bg-surface-2/30">
      <div className="border-hairline flex items-center gap-1.5 border-b px-3 py-2">
        <span className="label-xs mr-1">Show</span>
        {(['best', 'latest'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOrder(o)}
            className={cn(
              'text-13 rounded-[6px] border px-2 py-1 transition-colors',
              order === o
                ? 'border-accent bg-accent-soft text-fg'
                : 'border-hairline text-fg-muted hover:text-fg',
            )}
          >
            {o === 'best' ? 'Best ever' : 'Latest'}
          </button>
        ))}
        <span className="text-fg-muted ml-auto text-13">
          {order === 'best' ? `${shown.length} highest scoring` : `${shown.length} most recent`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="text-14 text-fg-muted px-4 py-6 text-center">No posts recorded yet.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {['When', 'Subreddit', 'Title', 'State', '↑', 'Replies'].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'label-xs border-hairline h-8 border-b px-3 font-normal whitespace-nowrap',
                    i > 3 && 'text-right',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-hairline hover:bg-surface border-b">
                <td className="text-13 text-fg-muted px-3 py-2 whitespace-nowrap">
                  {sinceLabel(p.postedAt)}
                </td>
                <td className="mono text-14 text-fg-secondary px-3 py-2 whitespace-nowrap">
                  r/{p.subreddit}
                </td>
                <td className="text-14 text-fg px-3 py-2">
                  <span className="flex items-start gap-2.5">
                    <Thumb src={p.thumbnailUrl} alt={p.title} href={p.mediaUrl ?? p.url} />
                    <span className="min-w-0">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent block"
                        >
                          {p.title}
                        </a>
                      ) : (
                        p.title
                      )}
                      {p.mediaUrl && (
                        <span className="text-13 text-fg-muted mt-0.5 block truncate">
                          {p.mediaUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <PostState status={p.status} removedBy={p.removedBy} />
                </td>
                <td className="mono tnum text-fg px-3 py-2 text-right text-14">{p.score || '—'}</td>
                <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                  {p.comments || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Live, or gone and by whose hand — the distinction the columns already make. */
function PostState({ status, removedBy }: { status: string; removedBy: string | null }) {
  if (status === 'LIVE') {
    return (
      <span className="text-positive border-positive/40 bg-positive/10 text-13 mono rounded-[4px] border px-1.5 py-0.5">
        live
      </span>
    )
  }
  const label =
    removedBy === 'MOD'
      ? 'mods'
      : removedBy === 'REDDIT'
        ? 'reddit'
        : removedBy === 'AUTHOR'
          ? 'deleted'
          : 'gone'
  return (
    <span
      className={cn(
        'text-13 mono rounded-[4px] border px-1.5 py-0.5',
        removedBy === 'REDDIT'
          ? 'text-negative border-negative/40 bg-negative/10'
          : removedBy === 'MOD'
            ? 'text-warning border-warning/40 bg-warning/10'
            : 'text-fg-muted border-hairline',
      )}
    >
      {label}
    </span>
  )
}

/** Reddit serves previews from its own CDN; expired ones fall back to an icon. */
function Thumb({ src, alt, href }: { src: string | null; alt: string; href: string | null }) {
  const [broken, setBroken] = React.useState(false)
  const box = 'border-hairline bg-surface-2 h-12 w-12 shrink-0 overflow-hidden rounded-[6px] border'
  if (!src || broken) {
    return (
      <span className={cn(box, 'text-fg-muted flex items-center justify-center')}>
        <ImageOff className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover"
    />
  )
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={box}>
      {img}
    </a>
  ) : (
    <span className={box}>{img}</span>
  )
}

/** A zero removal should not draw the eye; a non-zero one should. */
function Num({ v, tone }: { v: number; tone: 'positive' | 'warning' | 'negative' }) {
  return (
    <td
      className={cn(
        'mono tnum px-3 py-2 text-right text-14',
        v === 0
          ? 'text-fg-muted'
          : tone === 'positive'
            ? 'text-positive'
            : tone === 'warning'
              ? 'text-warning'
              : 'text-negative',
      )}
    >
      {v || '—'}
    </td>
  )
}

function State({ status }: { status: string }) {
  const dead = status === 'SUSPENDED' || status === 'SHADOWBANNED'
  return (
    <span
      className={cn(
        'text-13 mono rounded-[4px] border px-1.5 py-0.5 whitespace-nowrap',
        status === 'ACTIVE'
          ? 'text-positive border-positive/40 bg-positive/10'
          : dead
            ? 'text-negative border-negative/40 bg-negative/10'
            : 'text-fg-muted border-hairline',
      )}
    >
      {status.toLowerCase()}
    </span>
  )
}
