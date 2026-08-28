import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { accountScopeWhere } from '@/lib/queries/accounts'
import { PageHeader } from '@/components/shell/page-header'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusDot } from '@/components/ui/status-dot'
import { TierBadge } from '@/components/ui/badge'
import { SearchFilter } from '@/components/filters/search-filter'
import { ACCOUNT_STATUS_TONE, POST_STATUS_TONE } from '@/lib/display/account'
import { fmtCompact, fmtNum } from '@/lib/format'
import { fmtTs } from '@/lib/time'

export const metadata = { title: 'Search · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function SearchPage(props: PageProps<'/search'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const q = one(sp.q)?.trim() ?? ''

  if (!q) {
    return (
      <>
        <PageHeader title="Search" context="Accounts, posts, creators and subreddits" />
        <Card>
          <EmptyState
            title="Type something."
            hint="Account usernames, post titles, creator or subreddit names."
          />
        </Card>
      </>
    )
  }

  const like = { contains: q, mode: 'insensitive' as const }

  // Role scope applies here exactly as it does on the account database — search
  // is not a side door around it.
  const [accounts, posts, creators, subreddits] = await Promise.all([
    prisma.redditAccount.findMany({
      where: {
        AND: [accountScopeWhere(ctx), { OR: [{ username: like }, { emailAddress: like }] }],
      },
      orderBy: { healthScore: 'desc' },
      take: 12,
      select: {
        id: true,
        username: true,
        status: true,
        healthScore: true,
        karmaPost: true,
        assignedCreator: { select: { stageName: true } },
      },
    }),
    prisma.post.findMany({
      where: {
        title: like,
        ...(ctx.isManager ? {} : { posterId: ctx.user.id }),
      },
      orderBy: { postedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        title: true,
        postedAt: true,
        status: true,
        latestUpvotes: true,
        subreddit: { select: { name: true, tier: true } },
        redditAccount: { select: { id: true, username: true } },
      },
    }),
    ctx.isManager
      ? prisma.creator.findMany({
          where: { OR: [{ stageName: like }, { ofUsername: like }, { niche: like }] },
          take: 8,
          select: { id: true, stageName: true, niche: true, status: true },
        })
      : Promise.resolve([]),
    prisma.subreddit.findMany({
      where: { name: like },
      orderBy: { subscribers: 'desc' },
      take: 8,
      select: { id: true, name: true, tier: true, status: true, subscribers: true },
    }),
  ])

  const empty =
    accounts.length === 0 && posts.length === 0 && creators.length === 0 && subreddits.length === 0

  return (
    <>
      <PageHeader
        title="Search"
        context={`“${q}”${ctx.isManager ? '' : ' · limited to what you work on'}`}
        filters={<SearchFilter value={q} placeholder="Search…" />}
      />

      {empty ? (
        <Card>
          <EmptyState
            title="No matches."
            hint="Try a shorter fragment — search is a substring match."
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {accounts.length > 0 && (
            <Section title="Accounts" count={accounts.length}>
              {accounts.map((a) => (
                <Row key={a.id} href={`/accounts?account=${a.id}`}>
                  <StatusDot tone={ACCOUNT_STATUS_TONE[a.status] ?? 'muted'} />
                  <span className="mono text-14 text-fg w-44 truncate">u/{a.username}</span>
                  <span className="sublabel flex-1 truncate">
                    {a.assignedCreator?.stageName ?? 'unassigned'} · health {a.healthScore} ·{' '}
                    {fmtNum(a.karmaPost)} karma
                  </span>
                </Row>
              ))}
            </Section>
          )}

          {posts.length > 0 && (
            <Section title="Posts" count={posts.length}>
              {posts.map((p) => (
                <Row key={p.id} href={`/accounts?account=${p.redditAccount.id}`}>
                  <StatusDot tone={POST_STATUS_TONE[p.status] ?? 'muted'} />
                  <TierBadge tier={p.subreddit.tier} />
                  <div className="min-w-0 flex-1">
                    <div className="text-14 text-fg truncate">{p.title}</div>
                    <div className="sublabel truncate">
                      r/{p.subreddit.name} · u/{p.redditAccount.username} ·{' '}
                      {fmtTs(p.postedAt, ctx.user.timezone)}
                    </div>
                  </div>
                  <span className="mono text-14 text-fg shrink-0">
                    {fmtCompact(p.latestUpvotes)}
                  </span>
                </Row>
              ))}
            </Section>
          )}

          {creators.length > 0 && (
            <Section title="Creators" count={creators.length}>
              {creators.map((c) => (
                <Row key={c.id} href={`/overview?creator=${c.id}`}>
                  <StatusDot tone={c.status === 'ACTIVE' ? 'positive' : 'muted'} />
                  <span className="text-14 text-fg w-44 truncate">{c.stageName}</span>
                  <span className="sublabel flex-1 truncate">
                    {c.niche ?? '—'} · {c.status.toLowerCase()}
                  </span>
                </Row>
              ))}
            </Section>
          )}

          {subreddits.length > 0 && (
            <Section title="Subreddits" count={subreddits.length}>
              {subreddits.map((s) => (
                <Row key={s.id} href={`/admin/subreddits?q=${encodeURIComponent(s.name)}`}>
                  <TierBadge tier={s.tier} />
                  <span className="text-14 text-fg w-44 truncate">r/{s.name}</span>
                  <span className="sublabel flex-1 truncate">
                    {fmtCompact(s.subscribers)} subs · {s.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </Row>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <Card className="self-start">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">{title}</h3>
        <span className="sublabel">{count}</span>
      </div>
      <ul className="divide-hairline divide-y">{children}</ul>
    </Card>
  )
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="hover:bg-surface-2 flex items-center gap-2.5 px-4 py-2.5">
        {children}
      </Link>
    </li>
  )
}
