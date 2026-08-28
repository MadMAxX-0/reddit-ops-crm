'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Copy, ExternalLink, KeyRound, Loader2, Plus, Search, X } from 'lucide-react'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import { addAccounts, removeAccounts, setDevice, setFlag, setStage } from './actions'
import { cn } from '@/lib/utils'

/**
 * The pipeline the team works from: one row per account, the device it lives
 * on, how old it is, the stage it is at, a flag when it is dead, and a move to
 * push it forward.
 *
 * Accounts run Creating → Farming → Active. "Active" means assigned to a
 * creator and in rotation with a poster, so moving an account there is what
 * puts it on the grid — not a separate step somewhere else.
 */

type Stage = 'CREATING' | 'FARMING' | 'ACTIVE'
type Flag = 'NONE' | 'BANNED' | 'SHADOWBANNED' | 'ON_HOLD'

const STAGES: Stage[] = ['CREATING', 'FARMING', 'ACTIVE']
const STAGE_LABEL: Record<Stage, string> = {
  CREATING: 'Creating',
  FARMING: 'Farming',
  ACTIVE: 'Active',
}
const STAGE_STYLE: Record<Stage, string> = {
  CREATING: 'border-fg-muted/45 text-fg-secondary',
  FARMING: 'border-accent/60 text-accent',
  ACTIVE: 'border-positive/60 text-positive',
}

const FLAGS: Flag[] = ['NONE', 'BANNED', 'SHADOWBANNED', 'ON_HOLD']
const FLAG_LABEL: Record<Flag, string> = {
  NONE: '— No flag —',
  BANNED: 'Banned',
  SHADOWBANNED: 'Shadowbanned',
  ON_HOLD: 'On hold',
}

export interface PipelineRow {
  id: string
  username: string
  device: string | null
  stage: string
  flag: string
  modelLabel: string | null
  posterName: string | null
  ageDays: number | null
  karmaPost: number
  karmaComment: number
  lastCheckedAt: string | null
}

export function PipelineTable({
  rows,
  stageCounts,
  devices,
  deviceCounts,
  stageFilter,
  deviceFilter,
  q,
  canEdit,
  canRemove,
}: {
  rows: PipelineRow[]
  stageCounts: Record<string, number>
  devices: string[]
  deviceCounts: Record<string, number>
  stageFilter: string | null
  deviceFilter: string | null
  q: string
  canEdit: boolean
  canRemove: boolean
}) {
  const router = useRouter()
  const { set } = useFilterNav()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [adding, setAdding] = React.useState(false)

  const [rendered, setRendered] = React.useState(rows)
  if (rows !== rendered) {
    setRendered(rows)
    setSelected(new Set())
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const total = Object.values(stageCounts).reduce((s, n) => s + n, 0)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    await fn()
    setBusy(false)
    setSelected(new Set())
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="mono text-13 text-fg-secondary tracking-[0.16em] uppercase">
          [ All pipeline accounts ]
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="text-fg-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              defaultValue={q}
              placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value || null })
              }}
              className="bg-surface-2 border-hairline text-14 text-fg placeholder:text-fg-muted h-8 w-48 rounded-[6px] border pr-2.5 pl-8 outline-none focus:border-[#4a4a4a]"
            />
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="border-hairline text-13 text-fg hover:border-[#4a4a4a] hover:bg-surface-2 mono inline-flex h-8 items-center gap-1.5 rounded-[4px] border px-3 tracking-[0.09em] uppercase"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={!stageFilter} label={`All ${total}`} onClick={() => set({ stage: null })} />
        {STAGES.map((s) => (
          <Chip
            key={s}
            active={stageFilter === s}
            label={`${STAGE_LABEL[s]} ${stageCounts[s] ?? 0}`}
            onClick={() => set({ stage: s })}
          />
        ))}
        <span className="bg-hairline mx-1 h-4 w-px" />
        <select
          value={deviceFilter ?? ''}
          onChange={(e) => set({ device: e.target.value || null })}
          className="bg-surface-2 border-hairline text-13 text-fg-secondary h-6 rounded-[5px] border px-1.5 outline-none"
        >
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d} value={d}>
              {d} ({deviceCounts[d] ?? 0})
            </option>
          ))}
          <option value="none">No device ({deviceCounts.none ?? 0})</option>
        </select>
      </div>

      {adding && (
        <AddForm
          devices={devices}
          onDone={() => {
            setAdding(false)
            router.refresh()
          }}
        />
      )}

      {canEdit && selected.size > 0 && (
        <div className="bg-surface border-hairline flex flex-wrap items-center gap-2 rounded-[8px] border px-3 py-2">
          <span className="mono text-14 text-accent">{selected.size} selected</span>
          <span className="bg-hairline mx-1 h-4 w-px" />
          <span className="label-xs">Move to</span>
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => run(() => setStage([...selected], s))}
              className="bg-surface-2 border-hairline text-14 text-fg-secondary hover:text-fg h-7 rounded-[5px] border px-2.5"
            >
              {STAGE_LABEL[s]}
            </button>
          ))}
          <span className="bg-hairline mx-1 h-4 w-px" />
          <select
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value && run(() => setDevice([...selected], e.target.value))}
            className="bg-surface-2 border-hairline text-14 text-fg-secondary h-7 rounded-[5px] border px-2"
          >
            <option value="">Set device…</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setFlag([...selected], 'BANNED'))}
            className="bg-negative/12 border-negative/30 text-negative text-14 h-7 rounded-[5px] border px-2.5"
          >
            Mark banned
          </button>
          {canRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => removeAccounts([...selected]))}
              className="text-fg-muted hover:text-negative text-13 ml-auto"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Retire'}
            </button>
          )}
        </div>
      )}

      <div className="bg-surface border-hairline overflow-x-auto rounded-[8px] border">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-hairline border-b">
              <th className="w-9 px-3 py-2">
                {canEdit && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    className="accent-accent h-3 w-3"
                    aria-label="Select all"
                  />
                )}
              </th>
              <Th>Account</Th>
              <Th />
              <Th>Device</Th>
              <Th>Age</Th>
              <Th>Karma</Th>
              <Th>Stage</Th>
              <Th>Flag</Th>
              <Th>Move</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-fg-secondary text-15 px-3 py-10 text-center">
                  Nothing matches.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                canEdit={canEdit}
                canRemove={canRemove}
                devices={devices}
                selected={selected.has(row.id)}
                onToggle={() =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(row.id)) next.delete(row.id)
                    else next.add(row.id)
                    return next
                  })
                }
                onChanged={() => router.refresh()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="label-xs px-3 py-2 font-normal tracking-[0.06em] uppercase whitespace-nowrap">
      {children}
    </th>
  )
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-hairline text-13 h-6 rounded-[5px] border px-2 transition-colors',
        active
          ? 'bg-accent-soft border-accent/40 text-accent font-medium'
          : 'bg-surface-2 text-fg-secondary hover:text-fg',
      )}
    >
      {label}
    </button>
  )
}

function Row({
  row,
  canEdit,
  canRemove,
  devices,
  selected,
  onToggle,
  onChanged,
}: {
  row: PipelineRow
  canEdit: boolean
  canRemove: boolean
  devices: string[]
  selected: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [copied, setCopied] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [editingDevice, setEditingDevice] = React.useState(false)
  const stage = row.stage as Stage
  const flag = row.flag as Flag

  return (
    <tr
      className={cn(
        'border-hairline hover:bg-surface-2 border-b last:border-b-0',
        selected && 'bg-surface-2',
      )}
    >
      <td className="px-3 py-1">
        {canEdit && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="accent-accent h-3 w-3"
            aria-label={`Select ${row.username}`}
          />
        )}
      </td>

      <td className="px-3 py-1 whitespace-nowrap">
        <span className="mono text-14 text-fg">u/{row.username}</span>
        {row.modelLabel && <span className="text-13 text-fg-muted ml-2">{row.modelLabel}</span>}
        {row.posterName && <span className="text-13 text-fg-muted ml-2">· {row.posterName}</span>}
      </td>

      <td className="px-3 py-1">
        <div className="flex items-center gap-1">
          <SmallBtn
            onClick={() => {
              navigator.clipboard.writeText(row.username)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? <Check className="text-positive h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </SmallBtn>
          <a
            href={`https://www.reddit.com/user/${row.username}`}
            target="_blank"
            rel="noreferrer"
            className="bg-surface-2 border-hairline text-fg-secondary hover:text-fg inline-flex h-6 w-6 items-center justify-center rounded-[5px] border"
            aria-label="Open on Reddit"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
          <Link
            href={`/accounts?account=${row.id}`}
            className="bg-surface-2 border-hairline text-13 text-fg-secondary hover:text-fg inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 whitespace-nowrap"
          >
            <KeyRound className="text-accent h-3 w-3" /> Details
          </Link>
        </div>
      </td>

      <td className="text-14 text-fg-secondary px-3 py-1 whitespace-nowrap">
        {editingDevice ? (
          <select
            autoFocus
            defaultValue={row.device ?? ''}
            disabled={busy}
            onBlur={() => setEditingDevice(false)}
            onChange={async (e) => {
              setBusy(true)
              await setDevice([row.id], e.target.value)
              setBusy(false)
              setEditingDevice(false)
              onChanged()
            }}
            className="bg-surface-2 border-hairline text-13 text-fg h-6 rounded-[5px] border px-1.5 outline-none"
          >
            <option value="">— none —</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : row.device ? (
          <button
            type="button"
            onClick={() => canEdit && setEditingDevice(true)}
            className="hover:text-fg"
          >
            {row.device}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setEditingDevice(true)}
            className="text-accent hover:underline"
          >
            + device
          </button>
        )}
      </td>

      <td className="mono text-14 text-fg-secondary px-3 py-1 whitespace-nowrap">
        {row.ageDays == null ? '—' : row.ageDays === 0 ? 'today' : `${row.ageDays} days`}
      </td>

      {/* post + comment karma as of the last health check, so an account that
          has stopped growing is visible next to its age rather than a screen away */}
      <td className="mono text-14 px-3 py-1 whitespace-nowrap">
        {row.karmaPost + row.karmaComment === 0 ? (
          <span
            className="text-fg-muted"
            title={row.lastCheckedAt ? 'Checked, no karma yet' : 'Never checked'}
          >
            {row.lastCheckedAt ? '0' : '—'}
          </span>
        ) : (
          <span
            className="text-fg"
            title={`${row.karmaPost} post · ${row.karmaComment} comment${
              row.lastCheckedAt
                ? ` · checked ${new Date(row.lastCheckedAt).toLocaleDateString('en-GB')}`
                : ''
            }`}
          >
            {(row.karmaPost + row.karmaComment).toLocaleString('en-GB')}
          </span>
        )}
      </td>

      <td className="px-3 py-1">
        <span
          className={cn(
            'text-13 inline-flex h-5 items-center rounded-[4px] border px-2 font-medium whitespace-nowrap',
            STAGE_STYLE[stage],
          )}
        >
          {STAGE_LABEL[stage] ?? row.stage}
        </span>
      </td>

      <td className="px-3 py-1">
        <select
          value={flag}
          disabled={!canEdit || busy}
          onChange={async (e) => {
            setBusy(true)
            await setFlag([row.id], e.target.value as Flag)
            setBusy(false)
            onChanged()
          }}
          className={cn(
            'text-13 h-6 rounded-[5px] border px-1.5 outline-none',
            flag === 'NONE'
              ? 'bg-surface-2 border-hairline text-fg-muted'
              : 'bg-negative/10 border-negative/40 text-negative',
          )}
        >
          {FLAGS.map((f) => (
            <option key={f} value={f} className="bg-surface text-fg">
              {FLAG_LABEL[f]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-1">
        <select
          value={stage}
          disabled={!canEdit || busy}
          onChange={async (e) => {
            setBusy(true)
            await setStage([row.id], e.target.value as Stage)
            setBusy(false)
            onChanged()
          }}
          className="bg-surface-2 border-hairline text-13 text-fg-secondary h-6 rounded-[5px] border px-1.5 outline-none"
        >
          {STAGES.map((s) => (
            <option key={s} value={s} className="bg-surface text-fg">
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </td>

      <td className="px-3 py-1 text-right">
        {canRemove && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await removeAccounts([row.id])
              setBusy(false)
              onChanged()
            }}
            className="text-fg-muted hover:text-negative"
            title="Retire — keeps its history"
            aria-label={`Retire ${row.username}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-surface-2 border-hairline text-13 text-fg-secondary hover:text-fg inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 whitespace-nowrap"
    >
      {children}
    </button>
  )
}

function AddForm({ devices, onDone }: { devices: string[]; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const inputCls =
    'bg-surface-2 border-hairline text-fg text-14 h-8 rounded-[6px] border px-2 outline-none'

  return (
    <form
      className="bg-surface border-hairline flex flex-wrap items-end gap-2 rounded-[8px] border p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        setBusy(true)
        setMsg(null)
        const res = await addAccounts({
          usernames: String(f.get('usernames') ?? ''),
          device: String(f.get('device') ?? ''),
          stage: String(f.get('stage') ?? 'CREATING') as never,
        })
        setBusy(false)
        if (res.ok) {
          setMsg(
            `${res.created} added${res.skipped.length ? `, ${res.skipped.length} already existed` : ''}.`,
          )
          onDone()
        } else setMsg(res.error)
      }}
    >
      <label className="min-w-[260px] flex-1">
        <span className="label-xs mb-1 block">Usernames, one per line</span>
        <textarea
          name="usernames"
          rows={3}
          required
          spellCheck={false}
          className={cn(inputCls, 'mono h-auto w-full py-1.5')}
          placeholder={'u/cherrydraft\nu/idlecrushx'}
        />
      </label>
      <label>
        <span className="label-xs mb-1 block">Device</span>
        <select name="device" className={inputCls}>
          <option value="">— none —</option>
          {devices.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label-xs mb-1 block">Stage</span>
        <select name="stage" className={inputCls}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="bg-fg text-root mono inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-13 font-semibold tracking-[0.09em] uppercase hover:bg-[#e6e6e6]"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
      </button>
      {msg && <p className="text-14 text-fg-secondary w-full">{msg}</p>}
    </form>
  )
}
