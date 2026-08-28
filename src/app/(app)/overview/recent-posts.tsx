'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { StatusDot } from '@/components/ui/status-dot'
import { TierBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { fmtCompact } from '@/lib/format'
import { fmtRelative, fmtTs } from '@/lib/time'
import { POST_STATUS_TONE, POST_STATUS_LABEL } from '@/lib/display/account'

export interface RecentPostRow {
  id: string
  title: string
  postedAt: Date
  lagMin: number
  status: string
  attributionStatus: string
  upvotes: number
  landings: number
  url: string | null
  subreddit: string
  tier: string
  accountId: string
  username: string
  creatorName: string | null
  posterName: string | null
}

export function RecentPosts({ posts, displayTz }: { posts: RecentPostRow[]; displayTz: string }) {
  return (
    <Card>
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-15 text-fg font-semibold">Recent posts</h3>
        <span className="sublabel">discovered by the scraper · newest first</span>
      </div>
      {posts.length === 0 ? (
        <EmptyState title="Nothing discovered in this window." />
      ) : (
        <ul className="divide-hairline divide-y">
          {posts.map((p) => (
            <li key={p.id} className="hover:bg-surface-2 flex items-center gap-3 px-4 py-2.5">
              <StatusDot tone={POST_STATUS_TONE[p.status] ?? 'muted'} />
              <span
                className="mono text-14 text-fg-muted w-9 shrink-0 text-right"
                title={fmtTs(p.postedAt, displayTz)}
              >
                {fmtRelative(p.postedAt)}
              </span>
              <TierBadge tier={p.tier} />
              <div className="min-w-0 flex-1">
                <div className="text-14 text-fg truncate">{p.title}</div>
                <div className="sublabel truncate">
                  r/{p.subreddit} ·{' '}
                  <Link href={`/accounts?account=${p.accountId}`} className="hover:text-fg">
                    u/{p.username}
                  </Link>
                  {p.creatorName && ` · ${p.creatorName}`}
                  {p.posterName && ` · ${p.posterName}`}
                </div>
              </div>
              {p.attributionStatus === 'NEEDS_REVIEW' && (
                <span className="text-warning text-13 shrink-0">needs attribution</span>
              )}
              {p.status !== 'LIVE' && (
                <span className="text-negative text-13 shrink-0">
                  {POST_STATUS_LABEL[p.status]}
                </span>
              )}
              <span className="mono text-14 text-fg w-12 shrink-0 text-right" title="upvotes">
                {fmtCompact(p.upvotes)}
              </span>
              <span
                className="mono text-14 text-accent w-12 shrink-0 text-right"
                title="attributed landings"
              >
                {fmtCompact(p.landings)}
              </span>
              {p.url && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-muted hover:text-fg shrink-0"
                  aria-label="Open on Reddit"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
