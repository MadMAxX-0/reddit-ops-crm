import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { Targets } from './targets'
import { Discoveries } from './discoveries'
import { Niches } from './niches'

export const metadata = { title: 'Scraper · Reddit Ops CRM' }

/**
 * Building the subreddit list from evidence instead of memory.
 *
 * Three steps, in the order the screen shows them. Add usernames of accounts
 * working the niche; read where they post; read what each of those subreddits
 * demands of a poster. What comes out is a filtered set — no verification, low
 * karma floor, promotion allowed — that gets grouped into a list a VA is handed.
 *
 * Nothing here writes to Reddit, and no subreddit joins a list on its own.
 */
export default async function ScraperPage() {
  await requireManager()

  const [targets, observations, discoveries, niches] = await Promise.all([
    prisma.scrapeTarget.findMany({ orderBy: [{ active: 'desc' }, { username: 'asc' }] }),
    prisma.subredditObservation.groupBy({ by: ['targetId'], _count: { subreddit: true } }),
    prisma.discoveredSubreddit.findMany({
      // Audience first. Discovery order used to be "how many of our targets post
      // here", which answers a different question — it is how a subreddit was
      // found, not how much it is worth. Targets and posts stay as the
      // tiebreakers so a small sub several targets work still floats.
      orderBy: [
        { subscribers: { sort: 'desc', nulls: 'last' } },
        { targets: 'desc' },
        { posts: 'desc' },
      ],
      take: 500,
    }),
    prisma.subredditNiche.findMany({
      orderBy: { name: 'asc' },
      // Ordered in JS, not SQL: the sort key lives on the joined
      // DiscoveredSubreddit and Prisma cannot order a nested list by a relation.
      include: { items: { include: { discovered: true } } },
    }),
  ])

  const subsByTarget = new Map(observations.map((o) => [o.targetId, o._count.subreddit]))
  const unread = discoveries.filter((d) => !d.rulesCheckedAt && !d.dismissed).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scraper"
        context={`Add usernames · read where they post · read what those subreddits demand${
          unread ? ` · ${unread} not yet read` : ''
        }`}
      />

      <Targets
        canEdit
        rows={targets.map((t) => ({
          id: t.id,
          username: t.username,
          note: t.note,
          active: t.active,
          postsSeen: t.postsSeen,
          subreddits: subsByTarget.get(t.id) ?? 0,
          lastScrapedAt: t.lastScrapedAt ? t.lastScrapedAt.toISOString() : null,
          lastError: t.lastError,
        }))}
      />

      <Discoveries
        niches={niches.map((n) => ({ id: n.id, name: n.name }))}
        rows={discoveries.map((d) => ({
          name: d.name,
          subscribers: d.subscribers,
          over18: d.over18,
          posts: d.posts,
          targets: d.targets,
          avgScore: d.avgScore,
          bestScore: d.bestScore,
          promoted: d.promoted,
          dismissed: d.dismissed,
          minKarma: d.minKarma,
          minAccountAgeDays: d.minAccountAgeDays,
          requiresVerification: d.requiresVerification,
          originalContentOnly: d.originalContentOnly,
          bansAskingForUpvotes: d.bansAskingForUpvotes,
          ruleCount: d.ruleCount,
          rulesCheckedAt: d.rulesCheckedAt ? d.rulesCheckedAt.toISOString() : null,
        }))}
      />

      <Niches
        niches={niches.map((n) => ({
          id: n.id,
          name: n.name,
          note: n.note,
          color: n.color,
          // Biggest first. A subreddit list is a queue of work and the queue is
          // ordered by audience — alphabetical put r/AltTransGirlsPorn (16k)
          // above r/traps (2.1M). Dead subreddits sink to the bottom whatever
          // their size, because they are not work.
          items: [...n.items]
            .sort((a, b) => {
              const ad = a.discovered?.unavailable ? 1 : 0
              const bd = b.discovered?.unavailable ? 1 : 0
              if (ad !== bd) return ad - bd
              return (b.discovered?.subscribers ?? -1) - (a.discovered?.subscribers ?? -1)
            })
            .map((i) => ({
              subreddit: i.subreddit,
              subscribers: i.discovered?.subscribers ?? null,
              over18: i.discovered ? i.discovered.over18 : null,
              minKarma: i.discovered?.minKarma ?? null,
              minAccountAgeDays: i.discovered?.minAccountAgeDays ?? null,
              requiresVerification: i.discovered?.requiresVerification ?? null,
              originalContentOnly: i.discovered?.originalContentOnly ?? null,
              bansAskingForUpvotes: i.discovered?.bansAskingForUpvotes ?? null,
              rulesRead: !!i.discovered?.rulesCheckedAt,
              unavailable: i.discovered?.unavailable ?? false,
              note: i.note,
              submissionType: i.discovered?.submissionType ?? null,
              allowsImages: i.discovered?.allowsImages ?? null,
              allowsVideos: i.discovered?.allowsVideos ?? null,
              allowsGalleries: i.discovered?.allowsGalleries ?? null,
            })),
        }))}
      />
    </div>
  )
}
