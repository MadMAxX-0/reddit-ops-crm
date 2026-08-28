'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, Loader2, Upload, Wand2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { TwoLineCell } from '@/components/ui/two-line-cell'
import { TierBadge } from '@/components/ui/badge'
import { StatusDot, type Tone } from '@/components/ui/status-dot'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { fmtCompact, fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { fmtRelative } from '@/lib/time'
import type { SubredditRow } from '@/lib/queries/subreddits'
import { applySuggestions, importSubreddits, setStatus, setTier } from './actions'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'positive',
  RISKY: 'warning',
  BANNED_FOR_US: 'negative',
}
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  RISKY: 'Risky',
  BANNED_FOR_US: 'Banned for us',
}

export function SubredditTable({ rows, displayTz }: { rows: SubredditRow[]; displayTz: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const [showImport, setShowImport] = React.useState(false)

  const drifted = React.useMemo(
    () =>
      rows.filter((r) => !r.tierIsManual && r.suggestedTier !== '—' && r.suggestedTier !== r.tier),
    [rows],
  )

  async function onApply() {
    setBusy(true)
    setNote(null)
    const res = await applySuggestions(drifted.map((d) => ({ id: d.id, tier: d.suggestedTier })))
    setBusy(false)
    setNote(res.ok ? `Retiered ${res.applied} subreddits.` : res.error)
    if (res.ok) router.refresh()
  }

  const columns = React.useMemo<ColumnDef<SubredditRow, unknown>[]>(
    () => [
      {
        header: 'Subreddit',
        accessorKey: 'name',
        size: 220,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <TierPicker row={row.original} onDone={() => router.refresh()} />
            <TwoLineCell
              value={`r/${row.original.name}`}
              sub={`${fmtCompact(row.original.subscribers)} subs${row.original.verificationRequired ? ' · verified only' : ''}`}
            />
          </div>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        size: 132,
        cell: ({ row }) => <StatusPicker row={row.original} onDone={() => router.refresh()} />,
      },
      {
        header: 'Gates',
        accessorKey: 'minKarma',
        size: 130,
        cell: ({ row }) => (
          <TwoLineCell
            value={`${row.original.minKarma}k / ${row.original.minAccountAgeDays}d`}
            sub={`${row.original.postCooldownHours}h cooldown`}
          />
        ),
      },
      {
        header: 'Posts sent',
        accessorKey: 'posts',
        size: 100,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TwoLineCell
            align="right"
            value={fmtNum(row.original.posts)}
            sub={row.original.posts ? `${row.original.removed} removed` : 'none in range'}
          />
        ),
      },
      {
        header: 'Median upvotes',
        accessorKey: 'medianUpvotes',
        size: 110,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className="mono">
            {row.original.medianUpvotes == null ? '—' : fmtNum(row.original.medianUpvotes)}
          </span>
        ),
      },
      {
        header: 'Click rate (proxy)',
        accessorKey: 'ctrProxy',
        size: 104,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TwoLineCell
            align="right"
            value={fmtPct(row.original.ctrProxy, 1)}
            sub={`${fmtCompact(row.original.landings)} landings`}
          />
        ),
      },
      {
        header: 'Conv rate',
        accessorKey: 'convRate',
        size: 100,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TwoLineCell
            align="right"
            value={fmtPct(row.original.convRate, 2)}
            sub={`${row.original.conversions} subs`}
          />
        ),
      },
      {
        header: 'Removal rate',
        accessorKey: 'removalRate',
        size: 106,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span
            className={cn(
              'mono',
              row.original.removalRate != null && row.original.removalRate > 0.2 && 'text-negative',
            )}
          >
            {fmtPct(row.original.removalRate, 0)}
          </span>
        ),
      },
      {
        header: 'Revenue',
        accessorKey: 'revenueCents',
        size: 116,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TwoLineCell
            align="right"
            value={fmtMoney(row.original.revenueCents)}
            sub={
              row.original.revenuePerPostCents == null
                ? 'no posts'
                : `${fmtMoney(row.original.revenuePerPostCents)} / post`
            }
            tone="accent"
          />
        ),
      },
      {
        header: 'Suggested',
        accessorKey: 'suggestedTier',
        size: 104,
        cell: ({ row }) => {
          const s = row.original
          if (s.suggestedTier === '—') {
            return <span className="text-fg-muted text-13">too few posts</span>
          }
          if (s.tierIsManual) {
            return <span className="text-fg-muted text-13">set by hand</span>
          }
          return s.suggestedTier === s.tier ? (
            <span className="text-fg-muted text-13">matches</span>
          ) : (
            <span className="text-accent text-13 inline-flex items-center gap-1">
              <TierBadge tier={s.suggestedTier} /> suggested
            </span>
          )
        },
      },
      {
        header: 'Last scraped',
        accessorKey: 'lastScrapedAt',
        size: 100,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <span className="mono text-fg-secondary">{fmtRelative(row.original.lastScrapedAt)}</span>
        ),
      },
    ],
    [router, displayTz],
  )

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="text-14 text-fg-secondary">
          Tiering is a judgement about where our traffic converts, blended from conversion rate and
          removal rate — never from subscriber count.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowImport((v) => !v)}>
            <Upload className="h-3 w-3" /> Import CSV
          </Button>
          <a
            href={`/api/subreddits/export?${params.toString()}`}
            className="bg-surface-2 border-hairline text-14 text-fg hover:bg-[#1e232c] inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-3"
          >
            <Download className="h-3 w-3" /> Export CSV
          </a>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || drifted.length === 0}
            onClick={onApply}
            title={drifted.length === 0 ? 'Nothing to retier' : undefined}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Apply {drifted.length} suggestion{drifted.length === 1 ? '' : 's'}
          </Button>
        </div>
      </Card>

      {showImport && (
        <ImportPanel
          onDone={() => {
            setShowImport(false)
            router.refresh()
          }}
        />
      )}
      {note && <p className="text-14 text-fg-secondary">{note}</p>}

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        rowHeight={48}
        maxHeight={680}
        emptyTitle="No subreddits match these filters."
      />
    </div>
  )
}

function TierPicker({ row, onDone }: { row: SubredditRow; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  return (
    <select
      value={row.tier}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        setBusy(true)
        await setTier(row.id, e.target.value as never)
        setBusy(false)
        onDone()
      }}
      className="bg-surface-2 border-hairline mono text-13 text-fg h-5 w-9 rounded-[4px] border px-1 outline-none"
      aria-label={`Tier for r/${row.name}`}
    >
      {['S', 'A', 'B', 'C'].map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  )
}

function StatusPicker({ row, onDone }: { row: SubredditRow; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  return (
    <span className="flex items-center gap-1.5">
      <StatusDot tone={STATUS_TONE[row.status] ?? 'muted'} />
      <select
        value={row.status}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={async (e) => {
          setBusy(true)
          await setStatus(row.id, e.target.value as never)
          setBusy(false)
          onDone()
        }}
        className="bg-transparent text-14 text-fg outline-none"
        aria-label={`Status for r/${row.name}`}
      >
        {Object.entries(STATUS_LABEL).map(([v, label]) => (
          <option key={v} value={v} className="bg-surface">
            {label}
          </option>
        ))}
      </select>
    </span>
  )
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)

  return (
    <Card className="p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const csv = String(new FormData(e.currentTarget).get('csv') ?? '')
          setBusy(true)
          setResult(null)
          const res = await importSubreddits({ csv })
          setBusy(false)
          if (res.ok) {
            setResult(
              `${res.created} created, ${res.updated} updated${res.errors.length ? `, ${res.errors.length} skipped` : ''}.`,
            )
            onDone()
          } else setResult(res.error)
        }}
        className="space-y-3"
      >
        <div>
          <span className="label-xs mb-1 block">Paste CSV</span>
          <Textarea
            name="csv"
            rows={7}
            required
            spellCheck={false}
            className="mono text-13"
            placeholder={
              'name,tier,status,min_karma,min_account_age_days,post_cooldown_hours,verification_required,allowed_flairs,rules_summary\nOnlyFansPromo,S,ACTIVE,50,30,24,true,Promo|Free Page,"Verification required. One post per 24h."'
            }
          />
          <p className="text-fg-muted text-13 mt-1">
            Matched on <code className="mono">name</code>. Only playbook columns are imported —
            performance is always derived from our own posts and cannot be pasted in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Import'}
          </Button>
          {result && <span className="text-14 text-fg-secondary">{result}</span>}
        </div>
      </form>
    </Card>
  )
}
