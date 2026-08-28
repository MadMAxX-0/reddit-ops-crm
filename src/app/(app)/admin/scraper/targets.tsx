'use client'

import * as React from 'react'
import { Loader2, Play, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fmtNum } from '@/lib/format'
import { addTargets, removeTarget, scrapeNow, toggleTarget } from './actions'
import { cn } from '@/lib/utils'

/**
 * The accounts we watch, and a paste box to add more.
 *
 * Reading a public timeline is the whole mechanism — nothing is posted, nothing
 * is followed, no account of ours touches theirs.
 */

export interface TargetRow {
  id: string
  username: string
  note: string | null
  active: boolean
  postsSeen: number
  subreddits: number
  lastScrapedAt: string | null
  lastError: string | null
}

export function Targets({ rows, canEdit }: { rows: TargetRow[]; canEdit: boolean }) {
  const router = useRouter()
  const [raw, setRaw] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)

  async function add() {
    if (!raw.trim()) return
    setBusy('add')
    const res = await addTargets(raw)
    setMsg(res.ok ? `Added ${res.count}.` : res.error)
    if (res.ok) setRaw('')
    setBusy(null)
    router.refresh()
  }

  async function run() {
    setBusy('run')
    setMsg('Reading timelines…')
    const res = await scrapeNow()
    setMsg(res.ok ? 'Done.' : res.error)
    setBusy(null)
    router.refresh()
  }

  const stamp = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'never'

  return (
    <div className="bg-surface border-hairline overflow-hidden rounded-[10px] border">
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-16 text-fg font-semibold">Watched accounts</h2>
          <p className="text-fg-muted text-13">
            Public timelines only — we read where they post, nothing is posted or followed
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={run}
            disabled={busy != null || rows.length === 0}
            className="bg-fg text-root text-14 inline-flex h-8 items-center gap-2 rounded-[6px] px-3 font-medium disabled:opacity-40"
          >
            {busy === 'run' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Scrape now
          </button>
        )}
      </div>

      {canEdit && (
        <div className="border-hairline flex flex-wrap items-start gap-2 border-b px-4 py-3">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={2}
            placeholder="Paste usernames — u/name, one per line, commas or spaces all work"
            className="bg-surface-2 border-hairline text-14 text-fg placeholder:text-fg-muted min-w-[280px] flex-1 rounded-[6px] border px-2.5 py-2 outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy != null || !raw.trim()}
            className="border-hairline text-14 text-fg hover:bg-surface-2 h-9 rounded-[6px] border px-3 disabled:opacity-40"
          >
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
          {msg && <span className="text-fg-muted text-13 self-center">{msg}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-fg-muted text-14 px-4 py-6 text-center">
          No accounts watched yet. Add a few that post the kind of content you post.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-2">
              <tr>
                {['Account', 'Subreddits', 'Posts read', 'Last read', ''].map((h, i) => (
                  <th
                    key={h || 'x'}
                    className={cn(
                      'text-fg-secondary border-hairline h-9 border-b px-4 text-13 font-medium whitespace-nowrap',
                      i >= 1 && i <= 2 && 'text-right',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-hairline hover:bg-surface-2 border-b',
                    !r.active && 'opacity-50',
                  )}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <a
                      href={`https://reddit.com/user/${r.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-14 text-fg hover:text-accent"
                    >
                      u/{r.username}
                    </a>
                    {r.lastError && <div className="text-warning text-13">{r.lastError}</div>}
                  </td>
                  <td className="mono text-14 text-fg px-4 py-2.5 text-right">
                    {fmtNum(r.subreddits)}
                  </td>
                  <td className="mono text-14 text-fg-secondary px-4 py-2.5 text-right">
                    {fmtNum(r.postsSeen)}
                  </td>
                  <td className="text-14 text-fg-secondary px-4 py-2.5 whitespace-nowrap">
                    {stamp(r.lastScrapedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setBusy(r.id)
                            await toggleTarget(r.id, !r.active)
                            setBusy(null)
                            router.refresh()
                          }}
                          className="text-fg-muted hover:text-fg text-13"
                        >
                          {r.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setBusy(r.id)
                            await removeTarget(r.id)
                            setBusy(null)
                            router.refresh()
                          }}
                          className="text-fg-muted hover:text-negative"
                        >
                          {busy === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
