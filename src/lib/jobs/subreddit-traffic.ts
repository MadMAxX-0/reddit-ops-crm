import { prisma } from '@/lib/prisma'
import { RssRateLimited } from '@/lib/reddit/rss'

/**
 * How busy a subreddit is, from its own feed.
 *
 * Subscribers say how many people COULD see a post. This says how long it stays
 * visible: r/FemboySeduction takes 183 submissions a day and r/VenusTrans 40, so
 * the same post is buried by lunchtime in one and still on the front page the
 * next morning in the other. Reddit publishes no visitor count and the API host
 * will not serve NSFW listings, so this is the closest honest substitute — and
 * arguably the more useful number, because it measures competition rather than
 * theoretical audience.
 *
 * The median score matters as much as the rate: it is what a normal post gets
 * there, which is the bar a new post has to clear to be worth the slot.
 */
const UA =
  process.env.REDDIT_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

interface Sample {
  postsPerDay: number
  medianScore: number
  topScore: number
  sampled: number
}

export function parseTraffic(xml: string): Sample | null {
  const entries = xml.split('<entry>').slice(1)
  if (entries.length < 5) return null

  const times: number[] = []
  const scores: number[] = []
  for (const e of entries) {
    const t = e.match(/<updated>([^<]+)</)
    if (t) {
      const ms = new Date(t[1]).getTime()
      if (!Number.isNaN(ms)) times.push(ms)
    }
    // The feed has no score field. Reddit's own listing does, but not here — so
    // score is left to the enricher and only the rate is taken from the feed.
  }
  if (times.length < 5) return null
  times.sort((a, b) => b - a)
  const spanHours = (times[0] - times[times.length - 1]) / 3_600_000
  if (spanHours <= 0) return null

  const sorted = scores.sort((a, b) => a - b)
  return {
    postsPerDay: Math.round((times.length / (spanHours / 24)) * 10) / 10,
    medianScore: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    topScore: sorted.length ? sorted[sorted.length - 1] : 0,
    sampled: times.length,
  }
}

async function fetchFeed(name: string): Promise<string> {
  const res = await fetch(
    `https://www.reddit.com/r/${encodeURIComponent(name)}/new.rss?limit=100`,
    {
      headers: { 'user-agent': UA, accept: 'application/atom+xml, application/xml' },
      signal: AbortSignal.timeout(25_000),
    },
  )
  if (res.status === 429) throw new RssRateLimited()
  if (res.status === 404 || res.status === 403) return ''
  if (!res.ok) throw new Error(`${res.status} on r/${name}`)
  return res.text()
}

export async function measureTraffic(opts: { names?: string[]; limit?: number } = {}) {
  const stale = new Date(Date.now() - 7 * 86_400_000)
  const subs = await prisma.discoveredSubreddit.findMany({
    where: opts.names?.length
      ? { name: { in: opts.names } }
      : {
          unavailable: false,
          dismissed: false,
          OR: [{ trafficCheckedAt: null }, { trafficCheckedAt: { lt: stale } }],
        },
    orderBy: [{ trafficCheckedAt: { sort: 'asc', nulls: 'first' } }, { subscribers: 'desc' }],
    take: opts.limit ?? 40,
    select: { id: true, name: true },
  })

  let measured = 0
  let empty = 0
  const failures: string[] = []

  for (const s of subs) {
    let xml: string | null = null
    let wait = 5_000
    for (let attempt = 0; attempt < 5 && xml === null; attempt++) {
      try {
        xml = await fetchFeed(s.name)
      } catch (err) {
        if (err instanceof RssRateLimited) {
          await new Promise((r) => setTimeout(r, wait))
          wait = Math.min(wait * 2, 60_000)
          continue
        }
        failures.push(`${s.name}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }
    if (xml === null) continue

    const sample = xml ? parseTraffic(xml) : null
    if (!sample) {
      // Stamp it anyway so a quiet subreddit is not re-read every pass, but
      // leave the numbers null rather than writing a zero that reads as "dead".
      await prisma.discoveredSubreddit.update({
        where: { id: s.id },
        data: { trafficCheckedAt: new Date() },
      })
      empty += 1
      continue
    }

    await prisma.discoveredSubreddit.update({
      where: { id: s.id },
      data: {
        postsPerDay: sample.postsPerDay,
        trafficCheckedAt: new Date(),
      },
    })
    measured += 1
    await new Promise((r) => setTimeout(r, 4_000))
  }

  return { considered: subs.length, measured, empty, failures }
}
