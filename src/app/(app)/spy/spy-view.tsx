'use client'

import * as React from 'react'
import {
  ArrowUpRight,
  ChevronRight,
  ImageOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { fmtNum, fmtCompact } from '@/lib/format'
import { SPY_TAGS } from '@/lib/spy-tags'
import { cn } from '@/lib/utils'
import {
  addTargets,
  createAlbum,
  deleteAlbum,
  refreshSpy,
  removeTarget,
  saveToAlbum,
  setTags,
  toggleTarget,
} from './actions'

export interface SavedPost {
  id: string
  savedAt: string
  from: string
  subreddit: string
  title: string
  url: string | null
  thumbnailUrl: string | null
  mediaUrl: string | null
  score: number
  comments: number
  postedAt: string
}

export interface SpyAlbum {
  id: string
  name: string
  color: string | null
  /** posts kept in it */
  saved: number
  posts: SavedPost[]
}

export interface SpyRow {
  id: string
  username: string
  tags: string[]
  karma: number
  karmaChange: number
  upvotes: number
  active: boolean
  lastScrapedAt: string | null
  lastError: string | null
  total: number
  posts24h: number
  posts7d: number
  perDay: number
  medianScore: number
  topSubs: Array<[string, number]>
  best: SpyPost[]
  latest: SpyPost[]
}

export interface SpyPost {
  id: string
  subreddit: string
  title: string
  url: string | null
  thumbnailUrl: string | null
  mediaUrl: string | null
  score: number
  comments: number
  postedAt: string
  albumIds: string[]
}

function ago(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

export function SpyView({ rows, albums }: { rows: SpyRow[]; albums: SpyAlbum[] }) {
  const [album, setAlbum] = React.useState<string | null>(null)
  const [tag, setTag] = React.useState<string | null>(null)
  const [tagDraft, setTagDraft] = React.useState('')
  const [newAlbum, setNewAlbum] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)
  const [tagging, setTagging] = React.useState<string | null>(null)
  const [names, setNames] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function add() {
    setBusy('add')
    const r = await addTargets(names)
    setBusy(null)
    if (r.ok) setNames('')
    else setError(r.error)
  }

  async function refresh(username?: string) {
    setBusy(username ?? 'all')
    setError(null)
    const r = await refreshSpy(username)
    setBusy(null)
    if (!r.ok) setError(r.error)
  }

  const shown = rows.filter((r) => !tag || r.tags.includes(tag))
  const openAlbum = album ? (albums.find((a) => a.id === album) ?? null) : null

  return (
    <div className="space-y-3">
      {/* Albums lead: which set of people am I looking at. The accounts are the
          detail underneath, and an album's numbers are its members' summed —
          which is what makes two albums comparable. */}
      <div className="bg-surface border-hairline rounded-[10px] border px-4 py-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <span className="text-15 text-fg font-medium">Albums</span>
          <span className="text-13 text-fg-muted">
            saved posts — the titles, subreddits and timings worth copying
          </span>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {albums.map((a) => (
            <AlbumTile
              key={a.id}
              label={a.name}
              color={a.color}
              saved={a.saved}
              on={album === a.id}
              onClick={() => setAlbum(album === a.id ? null : a.id)}
              onDelete={() => deleteAlbum(a.id)}
            />
          ))}
          {adding ? (
            <span className="border-hairline flex items-center gap-1.5 rounded-[10px] border px-3 py-2">
              <input
                autoFocus
                value={newAlbum}
                onChange={(e) => setNewAlbum(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newAlbum.trim()) {
                    await createAlbum(newAlbum)
                    setNewAlbum('')
                    setAdding(false)
                  }
                  if (e.key === 'Escape') setAdding(false)
                }}
                placeholder="Album name"
                className="bg-surface-2 border-hairline text-14 text-fg h-8 w-40 rounded-[6px] border px-2 outline-none"
              />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="border-hairline text-fg-muted hover:text-fg hover:border-fg-muted text-14 flex min-w-28 flex-col items-center justify-center rounded-[10px] border border-dashed px-3 py-2"
            >
              <Plus className="mb-1 h-3.5 w-3.5" />
              Album
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface border-hairline flex flex-wrap items-center gap-2 rounded-[10px] border px-4 py-3">
        <input
          value={names}
          onChange={(e) => setNames(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && names.trim() && add()}
          placeholder="u/username — paste as many as you like, spaces or commas"
          className="bg-surface-2 border-hairline text-14 text-fg h-9 min-w-72 flex-1 rounded-[7px] border px-3 outline-none"
        />
        <button
          type="button"
          disabled={busy !== null || !names.trim()}
          onClick={add}
          className="bg-fg text-root text-14 flex h-9 items-center gap-1.5 rounded-[7px] px-3 font-medium disabled:opacity-40"
        >
          {busy === 'add' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Watch
        </button>
        <button
          type="button"
          disabled={busy !== null || rows.length === 0}
          onClick={() => refresh()}
          title="Reddit throttles the feed, so this takes about a minute per handful of accounts"
          className="border-hairline text-14 text-fg-secondary hover:text-fg hover:border-fg-muted flex h-9 items-center gap-1.5 rounded-[7px] border px-3 disabled:opacity-40"
        >
          {busy === 'all' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh all
        </button>
        {error && <span className="text-negative text-13">{error}</span>}
      </div>

      {openAlbum && (
        <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
          <div className="flex flex-wrap items-baseline gap-x-3 px-4 pt-4 pb-3">
            <span className="flex items-center gap-2">
              {openAlbum.color && (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: openAlbum.color }}
                  aria-hidden
                />
              )}
              <span className="text-18 text-fg font-semibold">{openAlbum.name}</span>
            </span>
            <span className="text-13 text-fg-muted">
              {openAlbum.posts.length} saved post{openAlbum.posts.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setAlbum(null)}
              className="text-13 text-fg-secondary hover:text-fg ml-auto"
            >
              Close
            </button>
          </div>

          {openAlbum.posts.length === 0 ? (
            <p className="text-14 text-fg-muted px-4 pb-10 text-center">
              Nothing saved here yet. Open an account below and use the album chip on a post.
            </p>
          ) : (
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
              {openAlbum.posts.map((p) => (
                <div key={p.id} className="border-hairline flex gap-3 rounded-[10px] border p-3">
                  <Thumb src={p.thumbnailUrl} alt={p.title} href={p.mediaUrl ?? p.url} large />
                  <div className="min-w-0 flex-1">
                    <a
                      href={p.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="text-14 text-fg hover:text-accent block"
                    >
                      {p.title}
                    </a>
                    <div className="text-13 text-fg-muted mt-1">
                      r/{p.subreddit} · u/{p.from}
                    </div>
                    <div className="text-13 mt-1 flex items-center gap-2">
                      <span className="text-positive tnum mono">{fmtNum(p.score)} ↑</span>
                      <span className="text-fg-muted tnum mono">{p.comments} 💬</span>
                      <button
                        type="button"
                        onClick={() => saveToAlbum(p.id, openAlbum.id, false)}
                        className="text-fg-muted hover:text-negative ml-auto"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The tag bar. A fixed vocabulary, always visible, one click to filter
          and one more to clear — the same shape the team already reads on the
          X tracker, so an account means the same thing on both. */}
      <div className="bg-surface border-hairline flex flex-wrap items-center gap-1.5 rounded-[10px] border px-4 py-2.5">
        <span className="label-xs mr-1">Tags</span>
        <button
          type="button"
          onClick={() => setTag(null)}
          className={cn(
            'text-13 rounded-[6px] px-2 py-1 transition-colors',
            tag === null ? 'text-fg-muted' : 'text-fg-secondary hover:text-fg',
          )}
        >
          clear
        </button>
        {SPY_TAGS.map((t) => {
          const n = rows.filter((r) => r.tags.includes(t)).length
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTag(tag === t ? null : t)}
              className={cn(
                'text-13 rounded-[6px] border px-2 py-1 transition-colors',
                tag === t
                  ? 'border-info bg-info-soft text-fg'
                  : n
                    ? 'border-hairline text-fg-secondary hover:text-fg'
                    : 'border-hairline text-fg-muted opacity-60 hover:opacity-100',
              )}
            >
              {t}
              {n > 0 && <span className="text-fg-muted ml-1">{n}</span>}
            </button>
          )
        })}
      </div>

      <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
        <div className="px-4 pt-4 pb-2">
          <div className="label-xs">Tracked accounts</div>
          <p className="sublabel mt-0.5">
            Public timelines, read over time. Change is karma movement since the previous read — a
            standing total says nothing, movement says they are working.
          </p>
        </div>

        {shown.length === 0 ? (
          <p className="text-14 text-fg-muted px-4 py-10 text-center">
            {tag || album
              ? 'Nothing matches that filter.'
              : 'Nobody watched yet. Paste a username above — anyone whose profile is public.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-2">
                <tr>
                  {['Account', 'Karma', 'Change', 'Posts', 'Tags', ''].map((h, i) => (
                    <th
                      key={h || i}
                      className={cn(
                        'label-xs border-hairline h-9 border-b px-3 font-normal whitespace-nowrap',
                        i > 0 && i < 4 && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="border-hairline hover:bg-surface-2 border-b align-top">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOpen(open === r.id ? null : r.id)}
                            className="mono text-14 text-fg hover:text-accent flex items-center gap-1 text-left font-medium"
                          >
                            <ChevronRight
                              className={cn(
                                'text-fg-muted h-3.5 w-3.5 transition-transform',
                                open === r.id && 'rotate-90',
                              )}
                              aria-hidden
                            />
                            u/{r.username}
                          </button>
                          <a
                            href={`https://www.reddit.com/user/${r.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open u/${r.username} on Reddit`}
                            className="text-fg-muted hover:text-fg flex h-5 w-5 items-center justify-center rounded-[4px]"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                          {!r.active && <span className="label-xs text-fg-muted">paused</span>}
                        </span>
                        <span className="text-13 text-fg-muted mt-0.5 block">
                          {r.lastError
                            ? r.lastError
                            : r.lastScrapedAt
                              ? `read ${ago(r.lastScrapedAt)} ago`
                              : 'never read'}
                        </span>
                      </td>
                      <td className="mono tnum text-fg px-3 py-2.5 text-right text-14 font-medium">
                        {r.karma ? fmtCompact(r.karma) : '—'}
                      </td>
                      <td
                        className={cn(
                          'mono tnum px-3 py-2.5 text-right text-14',
                          r.karmaChange > 0 ? 'text-positive' : 'text-fg-muted',
                        )}
                      >
                        {r.karmaChange > 0 ? `+${fmtNum(r.karmaChange)}` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                          className="mono tnum text-fg hover:text-accent block w-full text-right text-14"
                        >
                          {fmtNum(r.total)}
                        </button>
                        <span className="text-13 text-fg-muted block">
                          {r.perDay ? `${r.perDay}/day` : 'idle'}
                          {r.medianScore ? ` · ~${fmtNum(r.medianScore)} ↑` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap items-center gap-1">
                          {r.tags.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setTag(tag === t ? null : t)}
                              className="border-hairline bg-surface-2 text-13 text-fg-secondary hover:text-fg rounded-[5px] border px-1.5 py-0.5"
                            >
                              {t}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setTagging(tagging === r.id ? null : r.id)}
                            aria-label={`Edit tags for u/${r.username}`}
                            className="text-fg-muted hover:text-fg border-hairline flex h-5 w-5 items-center justify-center rounded-[5px] border border-dashed"
                          >
                            +
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => refresh(r.username)}
                          aria-label={`Refresh u/${r.username}`}
                          className="text-fg-muted hover:text-fg hover:bg-surface-2 inline-flex h-7 w-7 items-center justify-center rounded-[5px] disabled:opacity-40"
                        >
                          {busy === r.username ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleTarget(r.id, !r.active)}
                          className="text-fg-muted hover:text-fg text-13 rounded-[5px] px-1.5 py-1"
                        >
                          {r.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTarget(r.id)}
                          aria-label={`Stop watching u/${r.username}`}
                          className="text-fg-muted hover:text-negative inline-flex h-7 w-7 items-center justify-center rounded-[5px]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>

                    {tagging === r.id && (
                      <tr className="bg-surface-2 border-hairline border-b">
                        <td colSpan={6} className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="label-xs mr-1">Tag u/{r.username}</span>
                            {SPY_TAGS.map((t) => {
                              const on = r.tags.includes(t)
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={async () => {
                                    await setTags(
                                      r.id,
                                      on ? r.tags.filter((x) => x !== t) : [...r.tags, t],
                                    )
                                    // shut it: the row already shows the tags,
                                    // and a strip of 17 buttons left open under
                                    // every account is noise
                                    setTagging(null)
                                  }}
                                  className={cn(
                                    'text-13 rounded-[6px] border px-2 py-1 transition-colors',
                                    on
                                      ? 'border-info bg-info-soft text-fg'
                                      : 'border-hairline text-fg-muted hover:text-fg',
                                  )}
                                >
                                  {t}
                                </button>
                              )
                            })}
                          </span>
                        </td>
                      </tr>
                    )}

                    {open === r.id && (
                      <tr className="border-hairline border-b">
                        <td colSpan={6} className="p-0">
                          <PostList best={r.best} latest={r.latest} albums={albums} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** An account's recent posts, with the one-click save into an album. */
function PostList({
  best,
  latest,
  albums,
}: {
  best: SpyPost[]
  latest: SpyPost[]
  albums: SpyAlbum[]
}) {
  // Two questions, two orders. "Latest" is what they are doing now; "Best" is
  // what has ever worked, which is the only one worth copying. The feed is read
  // both ways — sort=new and sort=top — so Best genuinely reaches months back
  // rather than sorting the last few days by score.
  const [order, setOrder] = React.useState<'latest' | 'best'>('best')
  const shown = order === 'best' ? best : latest

  return (
    <div className="overflow-x-auto">
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
          {order === 'best'
            ? `${shown.length} highest scoring, all time`
            : `${shown.length} most recent`}
        </span>
      </div>
      <table className="w-full border-collapse text-left">
        <thead className="bg-surface-2/60">
          <tr>
            {['When', 'Subreddit', 'Title', '↑', 'Replies', 'Save to'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'label-xs border-hairline h-8 border-b px-3 font-normal whitespace-nowrap',
                  i > 2 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.id} className="border-hairline hover:bg-surface-2 border-b">
              <td className="text-13 text-fg-muted px-3 py-2 whitespace-nowrap">
                {ago(p.postedAt)} ago
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
                      <a
                        href={p.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-13 text-fg-muted hover:text-fg mt-0.5 block truncate"
                      >
                        {new URL(p.mediaUrl).hostname.replace(/^www\./, '')}
                      </a>
                    )}
                  </span>
                </span>
              </td>
              <td className="mono tnum text-fg px-3 py-2 text-right text-14">{p.score || '—'}</td>
              <td className="mono tnum text-fg-secondary px-3 py-2 text-right text-14">
                {p.comments || '—'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {albums.length === 0 ? (
                  <span className="text-13 text-fg-muted">make an album</span>
                ) : (
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {albums.map((a) => {
                      const inIt = p.albumIds.includes(a.id)
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => saveToAlbum(p.id, a.id, !inIt)}
                          title={inIt ? `Remove from ${a.name}` : `Save to ${a.name}`}
                          className={cn(
                            'text-13 flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5',
                            inIt
                              ? 'border-accent bg-accent-soft text-fg'
                              : 'border-hairline text-fg-muted hover:text-fg',
                          )}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: a.color ?? '#7C828E' }}
                            aria-hidden
                          />
                          {a.name}
                        </button>
                      )
                    })}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The post's preview image. Reddit serves these from its own CDN, so they load
 * without a proxy — and a swipe file of titles with no pictures is half a swipe
 * file. A broken image falls back to an icon rather than a torn placeholder,
 * because previews expire.
 */
function Thumb({
  src,
  alt,
  href,
  large,
}: {
  src: string | null
  alt: string
  href: string | null
  /** the album grid gives a post room; the row list does not */
  large?: boolean
}) {
  const [broken, setBroken] = React.useState(false)
  const box = cn(
    'border-hairline bg-surface-2 shrink-0 overflow-hidden rounded-[6px] border',
    large ? 'h-24 w-24' : 'h-12 w-12',
  )

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

/** One album: its name, its colour, and how many posts are kept in it. */
function AlbumTile({
  label,
  color,
  saved,
  on,
  onClick,
  onDelete,
}: {
  label: string
  color: string | null
  saved: number
  on: boolean
  onClick: () => void
  onDelete?: () => void
}) {
  return (
    <span
      className={cn(
        'group relative flex min-w-32 flex-col rounded-[10px] border px-3 py-2 transition-colors',
        on ? 'border-accent bg-accent-soft' : 'border-hairline hover:border-fg-muted',
      )}
    >
      <button type="button" onClick={onClick} className="text-left">
        <span className="flex items-center gap-1.5">
          {color && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: color }}
              aria-hidden
            />
          )}
          <span className="text-14 text-fg font-medium">{label}</span>
        </span>
        <span className="mono tnum text-24 text-fg mt-0.5 block font-semibold">
          {fmtNum(saved)}
        </span>
        <span className="text-13 text-fg-muted block">saved post{saved === 1 ? '' : 's'}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete album ${label}`}
          className="text-fg-muted hover:text-negative absolute top-1.5 right-1.5 hidden h-5 w-5 items-center justify-center rounded-[4px] group-hover:flex"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
