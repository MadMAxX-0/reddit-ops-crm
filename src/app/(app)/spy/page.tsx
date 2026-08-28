import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { SpyView } from './spy-view'

export const metadata = { title: 'Spy · Reddit Ops CRM' }

/**
 * Watch other people's accounts.
 *
 * The value is not the individual post, it is the pattern: how often a working
 * account posts, which subreddits it keeps going back to, what its titles look
 * like, and which of those actually landed. All of it is public — this is the
 * same page anyone can open, kept over time so it can be compared.
 */
export default async function SpyPage() {
  await requireManager()

  const [targets, albums] = await Promise.all([
    prisma.scrapeTarget.findMany({
      orderBy: [{ active: 'desc' }, { username: 'asc' }],
      include: {
        posts: {
          orderBy: { postedAt: 'desc' },
          take: 500,
          include: { albums: { select: { albumId: true } } },
        },
        _count: { select: { posts: true } },
      },
    }),
    prisma.spyAlbum.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { items: true } },
        // The saved posts themselves. An album that cannot be opened is a
        // counter, not a collection — this is the whole point of keeping them.
        items: {
          orderBy: { addedAt: 'desc' },
          include: { post: { include: { target: { select: { username: true } } } } },
        },
      },
    }),
  ])

  const shape = (p: (typeof targets)[number]['posts'][number]) => ({
    id: p.id,
    subreddit: p.subreddit,
    title: p.title,
    url: p.url,
    thumbnailUrl: p.thumbnailUrl,
    mediaUrl: p.mediaUrl,
    score: p.score,
    comments: p.comments,
    postedAt: p.postedAt.toISOString(),
    albumIds: p.albums.map((a) => a.albumId),
  })

  const now = Date.now()
  const rows = targets.map((t) => {
    const posts = t.posts
    const in7d = posts.filter((p) => now - p.postedAt.getTime() < 7 * 86_400_000)
    const in24 = posts.filter((p) => now - p.postedAt.getTime() < 86_400_000)
    const subs = new Map<string, number>()
    for (const p of posts) subs.set(p.subreddit, (subs.get(p.subreddit) ?? 0) + 1)
    const scored = posts.filter((p) => p.score > 0)
    return {
      id: t.id,
      username: t.username,
      tags: t.tags,
      karma: t.karma,
      karmaChange: t.karma - t.karmaPrev,
      active: t.active,
      lastScrapedAt: t.lastScrapedAt ? t.lastScrapedAt.toISOString() : null,
      lastError: t.lastError,
      total: t._count.posts,
      posts24h: in24.length,
      posts7d: in7d.length,
      // the number worth copying: how many a day when they are working
      perDay: in7d.length ? Math.round((in7d.length / 7) * 10) / 10 : 0,
      upvotes: posts.reduce((n, x) => n + x.score, 0),
      medianScore: scored.length
        ? scored.map((p) => p.score).sort((a, b) => a - b)[Math.floor(scored.length / 2)]
        : 0,
      topSubs: [...subs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      // Two separate lists rather than one list sorted two ways. "Best ever"
      // has to reach the whole history — an account's biggest post is usually
      // months old — while "Latest" only ever wants the newest twenty. Sorting
      // a recent slice by score answers neither question.
      best: posts
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(shape),
      latest: posts.slice(0, 20).map(shape),
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Spy"
        context="Accounts we watch — how often they post, where, and what lands. Public timelines only; nothing is written to Reddit."
      />
      <SpyView
        rows={rows}
        albums={albums.map((a) => ({
          id: a.id,
          name: a.name,
          color: a.color,
          saved: a._count.items,
          posts: a.items.map((i) => ({
            id: i.post.id,
            savedAt: i.addedAt.toISOString(),
            from: i.post.target.username,
            subreddit: i.post.subreddit,
            title: i.post.title,
            url: i.post.url,
            thumbnailUrl: i.post.thumbnailUrl,
            mediaUrl: i.post.mediaUrl,
            score: i.post.score,
            comments: i.post.comments,
            postedAt: i.post.postedAt.toISOString(),
          })),
        }))}
      />
    </div>
  )
}
