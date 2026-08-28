/**
 * Reddit's own Atom feed for an account's submissions.
 *
 * This exists because enumeration was the one thing nothing else could do. The
 * RapidAPI host returns `success: true` with an empty array for accounts that
 * are posting several times a day — 9 of 13 accounts stayed empty across 10
 * attempts each — and reddit.com's JSON endpoints answer 403 from this machine
 * on every host and path tried.
 *
 * The RSS feed answers 200 with the full list, NSFW subreddits included. It is
 * rate limited hard (429 after a few calls in quick succession), so this is
 * deliberately slow and patient rather than parallel.
 *
 * What it does NOT carry: score, comment count, removal state. Those come from
 * a per-post lookup, which works reliably on the existing provider — the host
 * serves any individual post by URL, it just will not list them.
 */
export interface RssSubmission {
  redditPostId: string
  subreddit: string
  title: string
  url: string
  postedAt: Date
  /** Reddit's preview image for the post */
  thumbnailUrl: string | null
  /** where the post points — redgifs, imgur, an image host */
  mediaUrl: string | null
}

const UA =
  process.env.REDDIT_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function tag(entry: string, name: string): string {
  const m = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decode(m[1]) : ''
}

export function parseSubmissionsRss(xml: string): RssSubmission[] {
  const out: RssSubmission[] = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = tag(entry, 'id')
    if (!id.startsWith('t3_')) continue
    const url = (entry.match(/<link href="([^"]+)"/) ?? [])[1] ?? ''
    const subreddit = (entry.match(/<category term="([^"]+)"/) ?? [])[1] ?? ''
    const updated = tag(entry, 'updated')
    const postedAt = updated ? new Date(updated) : null
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue
    // The feed embeds the preview as media:thumbnail, and the content HTML
    // carries the outbound link as the anchor labelled [link].
    const thumb = (entry.match(/<media:thumbnail url="([^"]+)"/) ?? [])[1] ?? null
    const content = tag(entry, 'content')
    const outbound =
      (content.match(/href="([^"]+)">\s*\[link\]/) ?? [])[1] ??
      (content.match(/href="(https:\/\/(?:www\.)?(?:redgifs|imgur|i\.redd)[^"]+)"/) ?? [])[1] ??
      null

    out.push({
      redditPostId: id,
      thumbnailUrl: thumb ? thumb.replace(/&amp;/g, '&') : null,
      mediaUrl: outbound ? outbound.replace(/&amp;/g, '&') : null,
      // a profile post is filed under u_<name>, which is how the rest of the
      // CRM already stores it
      subreddit,
      title: decode(tag(entry, 'title')),
      url,
      postedAt,
    })
  }
  return out
}

export class RssRateLimited extends Error {
  constructor() {
    super('reddit rss rate limited')
    this.name = 'RssRateLimited'
  }
}

/**
 * One account's submissions. Throws `RssRateLimited` on 429 so the caller can
 * back off rather than record an empty timeline — the mistake that started all
 * of this was treating "no answer" as "no posts".
 */
export type FeedSort = 'new' | 'top'
/** Reddit's window for `sort=top`. Ignored for `new`. */
export type FeedWindow = 'day' | 'week' | 'month' | 'year' | 'all'

export async function fetchSubmissionsRss(
  username: string,
  sort: FeedSort = 'new',
  window: FeedWindow = 'all',
): Promise<RssSubmission[]> {
  // A feed carries 25 entries whichever way it is sorted, so `new` and `top`
  // return genuinely different posts: `new` is what they are doing now, `top`
  // is what has ever worked for them. Reading both is how a swipe file gets
  // anything older than last week.
  const qs = sort === 'top' ? `?sort=top&t=${window}` : ''
  const res = await fetch(
    `https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.rss${qs}`,
    {
      headers: {
        'user-agent': UA,
        accept: 'application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(25_000),
    },
  )
  if (res.status === 429) throw new RssRateLimited()
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`reddit rss ${res.status} for u/${username}`)
  return parseSubmissionsRss(await res.text())
}
