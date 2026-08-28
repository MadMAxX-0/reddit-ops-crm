'use client'

import * as React from 'react'
import { FileText, ImageOff, Images, Link2, Play } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface TopPostRow {
  id: string
  title: string
  url: string | null
  subreddit: string
  username: string
  modelLabel: string | null
  upvotes: number
  comments: number
  status: string
  postedAt: string
  mediaType: string
  mediaUrl: string | null
  thumbnailUrl: string | null
  selftext: string | null
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  IMAGE: Images,
  GALLERY: Images,
  VIDEO: Play,
  TEXT: FileText,
  LINK: Link2,
}

/**
 * The posts that did best, with the post itself rather than a description of it.
 *
 * Ranked on upvotes, and the caption says so, because no revenue figure exists
 * per post: money is traced to the fan who paid and the link they came through,
 * and one link is shared by every post an account ever made. Ranking these by
 * revenue would mean inventing an attribution this product refuses to invent.
 */
export function TopPosts({ posts, rangeLabel }: { posts: TopPostRow[]; rangeLabel: string }) {
  if (!posts.length) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-15 text-fg-secondary">No posts discovered in this window.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="border-hairline flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className="text-15 text-fg font-medium">Best performing posts</span>
        <span className="text-fg-muted text-13">
          across the accounts in rotation · {rangeLabel.toLowerCase()} · ranked by upvotes, because
          no revenue figure exists per post — one link is shared by every post an account makes
        </span>
      </div>

      <ul className="divide-hairline divide-y">
        {posts.map((p, i) => (
          <li key={p.id} className="hover:bg-surface-2 flex items-start gap-3 px-4 py-3">
            <span className="mono text-13 text-fg-muted w-4 shrink-0 pt-6 text-right">{i + 1}</span>
            <Thumb post={p} />
            <div className="min-w-0 flex-1">
              <a
                href={p.url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="text-15 text-fg hover:text-accent line-clamp-2 font-medium"
              >
                {p.title || '(no title)'}
              </a>
              {p.selftext && (
                <p className="text-13 text-fg-muted mt-0.5 line-clamp-2">{p.selftext}</p>
              )}
              <div className="text-13 text-fg-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="mono text-fg-secondary">r/{p.subreddit}</span>
                <span aria-hidden>·</span>
                <span className="mono">u/{p.username}</span>
                {p.modelLabel && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{p.modelLabel}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>
                  {new Date(p.postedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                {p.status !== 'LIVE' && (
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-px',
                      p.status === 'REMOVED'
                        ? 'text-negative border-negative/35'
                        : 'text-fg-muted border-hairline',
                    )}
                  >
                    {p.status.toLowerCase()}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 pt-0.5 text-right">
              <div className="mono text-15 text-fg font-medium">{fmtNum(p.upvotes)}</div>
              <div className="text-13 text-fg-muted">upvotes</div>
              <div className="text-13 text-fg-muted mt-1">{fmtNum(p.comments)} comments</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Reddit's preview URLs expire and NSFW posts often carry a placeholder instead
 * of an image, so a broken thumbnail is normal rather than exceptional. It
 * falls back to the media type's icon rather than a broken-image glyph.
 */
function Thumb({ post }: { post: TopPostRow }) {
  const [failed, setFailed] = React.useState(false)
  const src = post.thumbnailUrl ?? (post.mediaType === 'IMAGE' ? post.mediaUrl : null)
  const Icon = KIND_ICON[post.mediaType] ?? ImageOff

  if (!src || failed) {
    return (
      <div className="bg-surface-2 border-hairline text-fg-muted flex h-14 w-14 shrink-0 items-center justify-center rounded-[7px] border">
        <Icon className="h-4 w-4" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="bg-surface-2 border-hairline h-14 w-14 shrink-0 rounded-[7px] border object-cover"
    />
  )
}
