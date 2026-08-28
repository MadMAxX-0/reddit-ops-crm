'use client'

import * as React from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import { UrlDrawer, DrawerSection, KeyValue } from '@/components/ui/drawer'
import { StatusDot } from '@/components/ui/status-dot'
import { TierBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { AreaGradient, CHART_COLORS, DarkTooltip, XA, YA, Grid } from '@/components/ui/chart-theme'
import { fmtCompact, fmtDuration, fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { fmtTs, fmtRelative } from '@/lib/time'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, POST_STATUS_TONE } from '@/lib/display/account'
import type { AccountDetail } from '@/lib/queries/account-detail'
import { revealCredential } from './actions'

export function AccountDrawer({
  detail,
  displayTz,
}: {
  detail: AccountDetail
  displayTz: string
  canMutate: boolean
}) {
  const a = detail.account
  const link = a.trackedLinks.find((l) => l.status === 'ACTIVE') ?? a.trackedLinks[0]
  const removed = detail.posts.filter((p) => p.status === 'REMOVED').length
  const lagMins = detail.posts
    .map((p) => (p.firstSeenAt.getTime() - p.postedAt.getTime()) / 60000)
    .sort((x, y) => x - y)
  const medianLag = lagMins.length ? lagMins[Math.floor(lagMins.length / 2)] : null
  // Two snapshots is the minimum that makes a delta mean anything; one snapshot
  // would report the whole follower count as growth.
  const followerDelta =
    detail.karma.length >= 2
      ? detail.karma[detail.karma.length - 1].followers - detail.karma[0].followers
      : null

  return (
    <UrlDrawer
      paramKey="account"
      title={`u/${a.username}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusDot
            tone={ACCOUNT_STATUS_TONE[a.status] ?? 'muted'}
            label={ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
            colorText
          />
          <span>·</span>
          <span>health {a.healthScore}</span>
          <span>·</span>
          <span>{a.pollTier.toLowerCase()} tier</span>
        </span>
      }
      width={780}
    >
      <DrawerSection title="Credentials">
        <CredentialBlock accountId={a.id} username={a.username} email={a.emailAddress} />
      </DrawerSection>

      <DrawerSection title="Identity">
        <KeyValue
          items={[
            { k: 'Email provider', v: a.emailProvider ?? '—' },
            { k: 'Email verified', v: a.emailVerified ? 'yes' : 'no' },
            { k: 'Phone verified', v: a.phoneVerified ? 'yes' : 'no' },
            { k: 'Proxy', v: a.proxy ? `${a.proxy.label} · ${a.proxy.countryCode ?? '—'}` : '—' },
            {
              k: 'Created on Reddit',
              v: a.redditCreatedAt ? fmtTs(a.redditCreatedAt, displayTz) : '—',
            },
            { k: 'Created by', v: a.createdBy?.name ?? 'Imported at go-live' },
            { k: 'Post karma', v: fmtNum(a.karmaPost) },
            { k: 'Comment karma', v: fmtNum(a.karmaComment) },
            { k: 'Followers', v: fmtNum(a.followers) },
            { k: 'Last checked', v: fmtTs(a.lastCheckedAt, displayTz) },
            { k: 'Suspected missed posts', v: a.suspectedMissedPosts },
          ]}
        />
        {a.verifiedSubreddits.length > 0 && (
          <div className="mt-3">
            <p className="label-xs mb-1.5">Verified in</p>
            <div className="flex flex-wrap gap-1">
              {a.verifiedSubreddits.map((s) => (
                <span
                  key={s}
                  className="mono text-13 border-hairline bg-surface-2 text-fg-secondary rounded-[4px] border px-1.5 py-0.5"
                >
                  r/{s}
                </span>
              ))}
            </div>
          </div>
        )}
        {a.notes && <p className="text-14 text-fg-secondary mt-3 leading-relaxed">{a.notes}</p>}
      </DrawerSection>

      {link && (
        <DrawerSection title="Deep link">
          <KeyValue
            items={[
              { k: 'Funnel slug', v: link.slug },
              { k: 'OF tracking link', v: link.ofTrackingLinkId ?? '—' },
              { k: 'Landings', v: fmtNum(detail.funnel.landings) },
              {
                k: 'Funnel pass',
                v: detail.funnel.landings
                  ? fmtPct(detail.funnel.outbound / detail.funnel.landings)
                  : '—',
              },
            ]}
          />
          <CopyRow value={link.funnelUrl} />
          {detail.funnel.landings === 0 && detail.posts.some((p) => p.status === 'LIVE') && (
            <p className="text-negative text-13 mt-2">
              Live posts but zero landings. The bio link is missing or broken — that is silent
              revenue loss, not a quiet week.
            </p>
          )}
        </DrawerSection>
      )}

      <DrawerSection
        title="Karma & followers"
        right={
          <span className="sublabel">
            last 30 days
            {followerDelta != null &&
              ` · ${followerDelta >= 0 ? '+' : ''}${fmtNum(followerDelta)} followers`}
          </span>
        }
      >
        {detail.karma.length < 2 ? (
          <EmptyState title="Not enough health snapshots yet." />
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={detail.karma.map((k) => ({
                  ts: k.capturedAt.getTime(),
                  post: k.karmaPost,
                  comment: k.karmaComment,
                  followers: k.followers,
                }))}
              >
                <defs>
                  <AreaGradient id="karmaPost" color={CHART_COLORS.accent} />
                  <AreaGradient id="karmaComment" color={CHART_COLORS.info} />
                  <AreaGradient id="followers" color={CHART_COLORS.positive} />
                </defs>
                <Grid />
                <XA
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v: number) => new Date(v).toISOString().slice(5, 10)}
                />
                <YA yAxisId="karma" tickFormatter={(v: number) => fmtCompact(v)} />
                <YA
                  yAxisId="followers"
                  orientation="right"
                  width={40}
                  tickFormatter={(v: number) => fmtCompact(v)}
                />
                <DarkTooltip
                  labelFormatter={(v) => fmtTs(new Date(Number(v)), displayTz)}
                  formatter={(v, n) => [
                    fmtNum(Number(v)),
                    n === 'post' ? 'Post karma' : n === 'comment' ? 'Comment karma' : 'Followers',
                  ]}
                />
                <Area
                  yAxisId="karma"
                  type="monotone"
                  dataKey="post"
                  stroke={CHART_COLORS.accent}
                  fill="url(#karmaPost)"
                  strokeWidth={1.5}
                />
                <Area
                  yAxisId="karma"
                  type="monotone"
                  dataKey="comment"
                  stroke={CHART_COLORS.info}
                  fill="url(#karmaComment)"
                  strokeWidth={1.5}
                />
                <Area
                  yAxisId="followers"
                  type="monotone"
                  dataKey="followers"
                  stroke={CHART_COLORS.positive}
                  fill="url(#followers)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </DrawerSection>

      <DrawerSection
        title="Assignment history"
        right={<span className="sublabel">{detail.assignments.length} spans</span>}
      >
        {detail.assignments.length === 0 ? (
          <EmptyState title="Never assigned." hint="Still in warm-up, or unassigned inventory." />
        ) : (
          <ul className="space-y-1.5">
            {detail.assignments.map((asg) => (
              <li key={asg.id} className="flex items-baseline justify-between gap-3">
                <span className="text-14 text-fg truncate">
                  {asg.creator.stageName} <span className="text-fg-muted">·</span> {asg.poster.name}
                </span>
                <span className="sublabel shrink-0">
                  {fmtTs(asg.startedAt, displayTz)} →{' '}
                  {asg.endedAt ? fmtTs(asg.endedAt, displayTz) : 'now'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-fg-muted text-13 mt-2.5 leading-relaxed">
          Posts keep the creator and poster who held this account at the moment they were posted.
          Reassigning never rewrites past numbers.
        </p>
      </DrawerSection>

      <DrawerSection
        title="Post history"
        right={
          <span className="sublabel">
            {detail.posts.length} shown · {removed} removed
            {medianLag != null && ` · median lag ${Math.round(medianLag)}m`}
          </span>
        }
      >
        {detail.posts.length === 0 ? (
          <EmptyState title="Nothing discovered from this account yet." />
        ) : (
          <ul className="divide-hairline divide-y">
            {detail.posts.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2">
                <StatusDot tone={POST_STATUS_TONE[p.status] ?? 'muted'} />
                <div className="min-w-0 flex-1">
                  <div className="text-14 text-fg truncate">{p.title}</div>
                  <div className="sublabel truncate">
                    r/{p.subreddit.name} · {fmtTs(p.postedAt, displayTz)} · seen{' '}
                    {fmtRelative(p.firstSeenAt)} after
                    {p.removalReason ? ` · ${p.removalReason}` : ''}
                  </div>
                </div>
                <TierBadge tier={p.subreddit.tier} />
                <span className="mono text-14 text-fg w-12 shrink-0 text-right">
                  {fmtCompact(p.latestUpvotes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection
        title="Farming sessions"
        right={<span className="sublabel">{detail.sessions.length} shown</span>}
      >
        {detail.sessions.length === 0 ? (
          <EmptyState title="No warm-up sessions logged." />
        ) : (
          <ul className="divide-hairline divide-y">
            {detail.sessions.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-14 text-fg truncate">{s.farmer.name}</span>
                <span className="sublabel shrink-0">
                  {fmtTs(s.startedAt, displayTz)} · {fmtDuration(s.durationMin)} · {s.commentsMade}c
                  · {s.karmaAfter - s.karmaBefore >= 0 ? '+' : ''}
                  {s.karmaAfter - s.karmaBefore} karma
                </span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title="Creation attempt">
        {detail.account.creationAttempt ? (
          <KeyValue
            items={[
              {
                k: 'Outcome',
                v: detail.account.creationAttempt.outcome.replace(/_/g, ' ').toLowerCase(),
              },
              {
                k: 'Batch date',
                v: detail.account.creationAttempt.batchDate.toISOString().slice(0, 10),
              },
              { k: 'Cost', v: fmtMoney(detail.account.creationAttempt.costCents) },
              { k: 'Refunded', v: fmtMoney(detail.account.creationAttempt.refundedCents) },
              { k: 'Proxy', v: detail.account.creationAttempt.proxy?.label ?? '—' },
              { k: 'Failure reason', v: detail.account.creationAttempt.failureReason ?? '—' },
            ]}
          />
        ) : (
          <EmptyState
            title="No creation attempt on file."
            hint="Imported at go-live, before attempt tracking existed."
          />
        )}
      </DrawerSection>
    </UrlDrawer>
  )
}

function CredentialBlock({
  accountId,
  username,
  email,
}: {
  accountId: string
  username: string
  email: string
}) {
  const [revealed, setRevealed] = React.useState<string | null>(null)
  const [asking, setAsking] = React.useState(false)
  const [pwd, setPwd] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onReveal() {
    if (revealed) {
      setRevealed(null)
      return
    }
    setError(null)
    setAsking(true)
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await revealCredential(accountId, pwd)
    setBusy(false)
    setPwd('')
    if (res.ok) {
      setRevealed(res.password)
      setAsking(false)
    } else setError(res.error)
  }

  return (
    <div className="space-y-2">
      <CopyRow label="Username" value={username} />
      <CopyRow label="Email" value={email} />
      <div className="flex items-center gap-2">
        <span className="text-fg-muted text-13 w-16 shrink-0">Password</span>
        <code className="mono bg-surface-2 border-hairline text-14 text-fg flex-1 truncate rounded-[5px] border px-2 py-1">
          {revealed ?? '••••••••••••'}
        </code>
        <Button size="sm" variant="secondary" onClick={onReveal} disabled={busy}>
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : revealed ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
          {revealed ? 'Hide' : 'Reveal'}
        </Button>
      </div>
      {asking && (
        <form
          onSubmit={confirm}
          className="border-hairline bg-surface-2 rounded-[6px] border p-2.5"
        >
          <label className="label-xs mb-1 block">Confirm it is you — re-enter your password</label>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="bg-surface border-hairline text-14 text-fg h-7 flex-1 rounded-[5px] border px-2 outline-none"
            />
            <Button type="submit" size="sm" variant="primary" disabled={busy || !pwd}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reveal'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(false)
                setPwd('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="text-negative text-13">{error}</p>}
      <p className="text-fg-muted text-13">
        Revealing requires your password again and is written to the audit log with your name, the
        account, and your IP. Failed attempts are logged too.
      </p>
    </div>
  )
}

function CopyRow({ label, value }: { label?: string; value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-fg-muted text-13 w-16 shrink-0">{label}</span>}
      <code className="mono bg-surface-2 border-hairline text-14 text-fg flex-1 truncate rounded-[5px] border px-2 py-1">
        {value}
      </code>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        <Copy className="h-3 w-3" />
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
