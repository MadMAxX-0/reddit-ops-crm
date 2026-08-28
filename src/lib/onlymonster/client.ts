/**
 * OnlyMonster — the agency's existing analytics tool, and the only record of who
 * arrived through which tracking link before this CRM existed.
 *
 * It matters because OnlyFans forgets. A fan who subscribes, spends and then
 * deletes their account is gone from every OnlyFans endpoint — asking for them
 * by id returns "User not found" — but OnlyMonster wrote them down while they
 * were there. Those fans are the entire difference between the CRM's subscriber
 * counts and the ones the team reads off OnlyMonster's own screen.
 *
 * Base is https://omapi.onlymonster.ai, auth is an `x-om-auth-token` header.
 */

export interface OmAccount {
  id: number
  ofUserId: string
  username: string | null
  name: string | null
}

export interface OmTrackingLink {
  /** the OnlyFans campaign id — the same value stored on OfCampaign.ofCampaignId */
  linkId: string
  name: string
  url: string | null
  isActive: boolean
  /** lifetime counters; OnlyMonster's own screen windows these from its history */
  clicks: number
  subscribers: number
  createdAt: string | null
}

export interface OmLinkFan {
  linkId: string
  fanId: string
  fanUsername: string | null
  /** when the fan actually subscribed — survives the fan being deleted */
  subscribedAt: string | null
  collectedAt: string | null
}

export class OnlyMonsterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OnlyMonsterError'
  }
}

export class OnlyMonsterClient {
  constructor(
    private readonly token: string,
    private readonly base = 'https://omapi.onlymonster.ai',
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, {
      headers: { 'x-om-auth-token': this.token, accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new OnlyMonsterError(
        `onlymonster ${res.status} on ${path}: ${text.slice(0, 200)}`,
        res.status,
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new OnlyMonsterError(`onlymonster returned non-JSON on ${path}`, res.status)
    }
  }

  async accounts(): Promise<OmAccount[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = await this.get<{ accounts: any[] }>('/api/v0/accounts')
    return (json.accounts ?? [])
      .filter((a) => a.platform === 'onlyfans')
      .map((a) => ({
        id: Number(a.id),
        ofUserId: String(a.platform_account_id),
        username: a.username ?? null,
        name: a.name ?? null,
      }))
  }

  /**
   * The account's tracking links. `start`/`end` filter on when the LINK was
   * created, not on activity, so this always reports lifetime click and
   * subscriber counters however the window is set.
   */
  async trackingLinks(
    ofUserId: string,
    since = '2020-01-01T00:00:00.000Z',
  ): Promise<OmTrackingLink[]> {
    const end = new Date().toISOString()
    const json = await this.get<{ items: any[] }>(
      `/api/v0/platforms/onlyfans/accounts/${ofUserId}/tracking-links` +
        `?start=${encodeURIComponent(since)}&end=${encodeURIComponent(end)}&limit=100`,
    )
    return (json.items ?? []).map((i) => ({
      linkId: String(i.id),
      name: String(i.name ?? ''),
      url: i.url ?? null,
      isActive: Boolean(i.is_active),
      clicks: Number(i.clicks ?? 0),
      subscribers: Number(i.subscribers ?? 0),
      createdAt: i.created_at ?? null,
    }))
  }

  /**
   * Every fan who arrived through a tracking link, with the date they subscribed.
   *
   * The `start`/`end` parameters filter on COLLECTION time, not subscribe time —
   * pass a month and you still get every fan the link ever had. The window has
   * to be applied to `subscribedAt` afterwards. Getting this wrong reads 1,347
   * where the answer is 435.
   */
  async trackingLinkUsers(ofUserId: string, onPage?: (rows: number) => void): Promise<OmLinkFan[]> {
    const out: OmLinkFan[] = []
    let cursor: string | null = null
    const start = '2020-01-01T00:00:00.000Z'
    const end = new Date().toISOString()

    for (let page = 0; page < 500; page++) {
      const qs =
        `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=500` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
      const json: any = await this.get<any>(
        `/api/v0/platforms/onlyfans/accounts/${ofUserId}/tracking-link-users${qs}`,
      )
      const items: any[] = json?.items ?? []
      for (const i of items) {
        if (!i?.link_id || !i?.fan?.id) continue
        out.push({
          linkId: String(i.link_id),
          fanId: String(i.fan.id),
          fanUsername: i.fan.username ?? null,
          subscribedAt: i.subscribed_at ?? null,
          collectedAt: i.collected_at ?? null,
        })
      }
      onPage?.(out.length)
      cursor = json?.cursor ?? null
      if (!cursor || items.length === 0) break
    }
    return out
  }
}

let cached: OnlyMonsterClient | null = null

export function onlyMonster(): OnlyMonsterClient | null {
  if (cached) return cached
  const token = process.env.ONLYMONSTER_TOKEN
  if (!token) return null
  cached = new OnlyMonsterClient(token, process.env.ONLYMONSTER_BASE_URL)
  return cached
}
