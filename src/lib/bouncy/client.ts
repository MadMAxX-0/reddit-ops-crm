/**
 * Bouncy.ai — the smart-link layer the bios actually point at.
 *
 * This is the only source of clicks BY DATE. Neither OnlyFans nor OnlyMonster
 * reports clicks over a range: both hold a lifetime counter, so a period figure
 * from them needs two readings taken days apart. Bouncy sits in front of the
 * OnlyFans link and logs every hit, so it can answer "how many clicks last
 * week" for a week that has already happened.
 *
 * Base https://api.bouncy.ai, auth `Authorization: Bearer <key>`. A publishable
 * key (`bcy_live_pk_`) is enough for analytics — an earlier pass through this
 * API concluded otherwise after probing invented paths, which was wrong; the
 * endpoint is documented at docs.bouncy.ai/api-reference/analytics.
 */

export interface BouncyLink {
  linkId: string
  slug: string
  domain: string | null
  destination: string
  isActive: boolean
  groupId: string | null
}

export interface BouncyDay {
  day: string
  /** hits on the link — for a deeplink this IS the click-through */
  views: number
  /** the portion whose referrer is a Reddit site or app */
  redditViews: number
}

export interface BouncyAnalytics {
  identifier: string
  totalViews: number
  days: BouncyDay[]
  referrers: Record<string, number>
}

const REDDIT_REFERRER = /reddit/i

export class BouncyClient {
  constructor(
    private readonly key: string,
    private readonly base = 'https://api.bouncy.ai',
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, {
      headers: { authorization: `Bearer ${this.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(45_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`bouncy ${res.status} on ${path}: ${text.slice(0, 180)}`)
    return JSON.parse(text) as T
  }

  async links(): Promise<BouncyLink[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = await this.get<{ data: any[] }>('/v1/links?limit=200')
    return (json.data ?? []).map((l) => ({
      linkId: String(l.id),
      slug: String(l.slug ?? ''),
      domain: l.domain ?? null,
      destination: String(l.destination ?? ''),
      isActive: Boolean(l.isActive),
      groupId: l.groupId ?? null,
    }))
  }

  /** Daily hits on one link between two dates, inclusive. */
  async analytics(identifier: string, from: string, to: string): Promise<BouncyAnalytics> {
    const json = await this.get<any>(
      `/v1/analytics/links/${encodeURIComponent(identifier)}?from=${from}&to=${to}`,
    )
    const days: BouncyDay[] = (json.dailyViews ?? []).map((d: any) => {
      const refs: Record<string, number> = d.referrers ?? {}
      let reddit = 0
      for (const [name, n] of Object.entries(refs)) {
        if (REDDIT_REFERRER.test(name)) reddit += Number(n) || 0
      }
      return { day: String(d.date), views: Number(d.views ?? 0), redditViews: reddit }
    })
    return {
      identifier: String(json.identifier ?? identifier),
      totalViews: Number(json.totalViews ?? 0),
      days,
      referrers: json.referrerStats ?? {},
    }
  }
}

let cached: BouncyClient | null = null

export function bouncy(): BouncyClient | null {
  if (cached) return cached
  const key = process.env.BOUNCY_KEY
  if (!key) return null
  cached = new BouncyClient(key, process.env.BOUNCY_BASE_URL)
  return cached
}

/**
 * Reads the OnlyFans campaign a bouncy link points at, from its destination.
 * `https://onlyfans.com/itsqueenzoe/c62` -> { username: 'itsqueenzoe', code: 62 }
 */
export function campaignFromDestination(
  destination: string,
): { username: string; code: number } | null {
  const m = /onlyfans\.com\/([A-Za-z0-9_.-]+)\/c(\d+)\b/i.exec(destination)
  if (!m) return null
  return { username: m[1], code: Number(m[2]) }
}
