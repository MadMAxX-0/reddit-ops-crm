import { NextResponse } from 'next/server'
import { parseSubmissionsRss } from '@/lib/reddit/rss'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Can THIS machine read Reddit?
 *
 * The whole data pipeline rests on one thing: `reddit.com/…rss` answering 200.
 * It does from a residential connection. Whether it does from a cloud host is
 * the question that decides where this app can be deployed, and it is not worth
 * arguing about when it can be measured in five seconds.
 *
 * Hit `/api/diag/reddit` on any deployment. If `verdict` is "ok" the scrapers
 * can run there. If it is "blocked", set REDDIT_PROXY_URL to a residential exit
 * and hit it again.
 */
export async function GET() {
  const checks: Array<{ what: string; url: string }> = [
    { what: 'user submissions feed', url: 'https://www.reddit.com/user/spez/submitted.rss' },
    { what: 'subreddit feed', url: 'https://www.reddit.com/r/programming/new.rss?limit=25' },
    // The JSON endpoint is expected to fail everywhere, including from a
    // residential IP. It is here so a failure is recognisable as normal rather
    // than read as "Reddit is down".
    {
      what: 'json endpoint (expected to fail)',
      url: 'https://www.reddit.com/r/programming/about.json',
    },
  ]

  const results = []
  for (const c of checks) {
    const started = Date.now()
    try {
      const res = await fetch(c.url, {
        headers: {
          'user-agent':
            process.env.REDDIT_USER_AGENT ??
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          accept: 'application/atom+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(25_000),
      })
      const body = await res.text()
      const entries = c.url.endsWith('.json') ? null : parseSubmissionsRss(body).length
      results.push({
        ...c,
        status: res.status,
        ms: Date.now() - started,
        bytes: body.length,
        entries,
        ok: res.status === 200 && (entries === null || entries > 0),
      })
    } catch (err) {
      results.push({
        ...c,
        status: 0,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      })
    }
  }

  const feeds = results.filter((r) => !r.url.endsWith('.json'))
  const working = feeds.filter((r) => r.ok).length
  const verdict = working === feeds.length ? 'ok' : working > 0 ? 'partial' : 'blocked'

  return NextResponse.json(
    {
      verdict,
      meaning:
        verdict === 'ok'
          ? 'This host can read Reddit. The scrapers can run here.'
          : verdict === 'partial'
            ? 'Reddit answered some feeds and refused others — usually rate limiting, try again in a minute.'
            : 'This host cannot read Reddit. Set REDDIT_PROXY_URL to a residential exit and retry.',
      proxyConfigured: Boolean(process.env.REDDIT_PROXY_URL),
      checkedAt: new Date().toISOString(),
      results,
    },
    { status: 200 },
  )
}
