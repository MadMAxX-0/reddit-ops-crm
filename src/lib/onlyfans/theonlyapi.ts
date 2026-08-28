/**
 * TheOnlyAPI client — the CRM panel API.
 *
 * Base is `{baseUrl}/api/crm/{crmId}`, auth is an `X-API-Key` header. Money
 * comes back from this API as floating-point dollars; it is converted to
 * integer cents at the boundary here, because every money value elsewhere in
 * this codebase is cents and mixing the two is how rounding errors get into a
 * revenue figure.
 */

export interface OfAccount {
  ofUserId: string
  username: string | null
  platform: string
  balanceAvailableCents: number
  balancePendingCents: number
  needsReconnect: boolean
  lastBalanceAt: string | null
}

export interface OfSubscriberCache {
  ofUserId: string
  activeSubs: number
  expiredSubs: number
  totalSubs: number
  spenders: number
  totalSpentCents: number
  lastRefreshedAt: string | null
}

export type OfPeriod = 'today' | 'week' | 'month'

/**
 * An OnlyFans tracking link. `campaignCode` is the number in the URL —
 * `onlyfans.com/laliwhite/c40` is code 40 — and clicks/subs are LIFETIME
 * counters, not period figures.
 */
export interface OfCampaign {
  ofCampaignId: string
  campaignCode: number
  name: string
  clicks: number
  subs: number
  createdAt: string | null
  isDeleted: boolean
}

/** A fan who subscribed through a particular tracking link. */
export interface OfClaimer {
  fanId: string
  fanUsername: string | null
  claimedAt: string | null
  /** the platform's own subscribe date on the claimer row */
  subscribedAt: string | null
  totalSpentCents: number
}

/** One money movement on an account, with the fan who caused it. */
export interface OfTransaction {
  txId: string
  fanId: string | null
  ts: string
  grossCents: number
  netCents: number
  kind: string | null
}

/** One day of one account's net earnings. */
export interface OfEarningsDay {
  day: string
  netCents: number
  transactions: number
}

export interface OfEarnings {
  period: OfPeriod
  totalCents: number
  prevTotalCents: number
  byCategoryCents: {
    messages: number
    subscriptions: number
    tips: number
    posts: number
    streams: number
    referrals: number
  }
  transactions: number
  accountsCount: number
  accountsNeverSynced: number
  chartDays: string[]
  chartCents: number[]
}

/** Dollars (possibly fractional) → integer cents. */
function cents(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export class TheOnlyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'TheOnlyApiError'
  }
}

export class TheOnlyApiClient {
  private readonly base: string

  constructor(
    private readonly apiKey: string,
    crmId: string,
    baseUrl = 'https://theonlyapi.com',
  ) {
    this.base = `${baseUrl.replace(/\/$/, '')}/api/crm/${crmId}`
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, {
      headers: { 'X-API-Key': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new TheOnlyApiError(
        `theonlyapi ${res.status} on ${path}: ${text.slice(0, 200)}`,
        res.status,
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new TheOnlyApiError(`theonlyapi returned non-JSON on ${path}`, res.status)
    }
  }

  async listAccounts(): Promise<OfAccount[]> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = await this.get<{ accounts: any[] }>('/accounts')
    return (json.accounts ?? []).map((a) => ({
      ofUserId: String(a.of_user_id),
      username: a.username ?? null,
      platform: a.platform ?? 'onlyfans',
      balanceAvailableCents: cents(a.last_balance_available),
      balancePendingCents: cents(a.last_balance_pending),
      needsReconnect: Boolean(a.needs_reconnect),
      lastBalanceAt: a.last_balance_at ?? null,
    }))
  }

  /**
   * Subscriber counts. Read from the cached listing with limit=1 — the stats
   * endpoint 500s, and the cache envelope carries every number we want without
   * paging seventeen thousand subscribers to count them.
   */
  async subscriberCache(ofUserId: string): Promise<OfSubscriberCache | null> {
    const json = await this.get<any>(`/accounts/${ofUserId}/subscribers/cached?limit=1`)
    const c = json?.cache
    if (!c) return null
    return {
      ofUserId,
      activeSubs: Number(c.active ?? 0),
      expiredSubs: Number(c.expired ?? 0),
      totalSubs: Number(c.total ?? 0),
      spenders: Number(c.spenders ?? 0),
      totalSpentCents: cents(c.total_spent_sum),
      lastRefreshedAt: c.last_refreshed_at ?? null,
    }
  }

  /**
   * Every tracking link on an account. The API pages at 10 by default and the
   * biggest account here has over a hundred links, so this pages to the end —
   * a truncated list would silently drop Reddit links and understate Reddit.
   */
  async campaigns(ofUserId: string): Promise<OfCampaign[]> {
    const out: OfCampaign[] = []
    const seen = new Set<number>()
    for (let offset = 0; offset < 2000; offset += 100) {
      const json = await this.get<any>(`/accounts/${ofUserId}/campaigns?limit=100&offset=${offset}`)
      const page: any[] = json?.campaigns ?? []
      const before = seen.size
      for (const c of page) {
        const code = Number(c.campaignCode)
        if (!Number.isFinite(code) || seen.has(code)) continue
        seen.add(code)
        out.push({
          ofCampaignId: String(c.id ?? ''),
          campaignCode: code,
          name: String(c.campaignName ?? ''),
          clicks: Number(c.countTransitions ?? 0),
          subs: Number(c.countSubscribers ?? 0),
          createdAt: c.createdAt ?? null,
          isDeleted: Boolean(c.isDeleted),
        })
      }
      // stop on the API's own signal, and independently on a page that adds
      // nothing new — an endpoint that ignores `offset` would otherwise loop
      if (!json?.hasMore || page.length === 0 || seen.size === before) break
    }
    return out
  }

  /**
   * Every subscriber on an account, from the cache, with the date they actually
   * subscribed and what they have spent. Zero platform requests.
   */
  async subscribersCached(
    ofUserId: string,
    onPage?: (fetched: number, total: number | null) => void,
  ): Promise<
    Array<{
      fanId: string
      subscribedAt: string | null
      expiredAt: string | null
      totalSpentCents: number
    }>
  > {
    const out: Array<{
      fanId: string
      subscribedAt: string | null
      expiredAt: string | null
      totalSpentCents: number
    }> = []
    for (let offset = 0; offset < 1_000_000; offset += 500) {
      const json = await this.get<any>(
        `/accounts/${ofUserId}/subscribers/cached?limit=500&offset=${offset}`,
      )
      const page: any[] = json?.list ?? []
      for (const f of page) {
        const id = f?.id ?? f?.fan_of_user_id
        if (id == null) continue
        out.push({
          fanId: String(id),
          subscribedAt: f.subscribed_at ?? null,
          expiredAt: f.expired_at ?? null,
          totalSpentCents: cents(f.total_spent),
        })
      }
      onPage?.(out.length, json?.total ?? null)
      if (!json?.hasMore || page.length === 0) break
    }
    return out
  }

  /**
   * The fans who converted through one tracking link, from the cache (the live
   * endpoint spends platform requests; this does not).
   */
  async campaignClaimers(ofUserId: string, campaignId: string): Promise<OfClaimer[]> {
    const out: OfClaimer[] = []
    for (let offset = 0; offset < 100_000; offset += 200) {
      const json = await this.get<any>(
        `/accounts/${ofUserId}/campaigns/${campaignId}/claimers/cached?limit=200&offset=${offset}`,
      )
      const page: any[] = json?.list ?? []
      for (const c of page) {
        if (!c.fan_of_user_id) continue
        out.push({
          fanId: String(c.fan_of_user_id),
          fanUsername: c.fan_username ?? null,
          claimedAt: c.claimed_at ?? null,
          subscribedAt: c.subscribed_at ?? null,
          totalSpentCents: cents(c.total_spent),
        })
      }
      if (!json?.hasMore || page.length === 0) break
    }
    return out
  }

  /**
   * The same claimers, fetched from the platform rather than the cache.
   *
   * Needed because the cache does not walk every link — the oldest, biggest
   * links are exactly the ones it skips, and those are where years of Reddit
   * traffic sit. This costs platform requests, so it is called deliberately,
   * never on a timer. The rows come back as bare fan records with no claim
   * date, so arrival dates stay unknown for links walked this way.
   */
  async campaignClaimersLive(
    ofUserId: string,
    campaignId: string,
    onPage?: (fetched: number, total: number | null) => void,
  ): Promise<OfClaimer[]> {
    const out: OfClaimer[] = []
    const seen = new Set<string>()
    for (let offset = 0; offset < 200_000; offset += 100) {
      const json = await this.get<any>(
        `/accounts/${ofUserId}/campaigns/${campaignId}/claimers?limit=100&offset=${offset}`,
      )
      const page: any[] = json?.claimers ?? []
      for (const c of page) {
        const id = c?.id != null ? String(c.id) : null
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({
          fanId: id,
          fanUsername: c.username || null,
          claimedAt: null,
          subscribedAt: null,
          totalSpentCents: 0,
        })
      }
      onPage?.(out.length, json?.count ?? null)
      if (!json?.hasMore || page.length === 0) break
    }
    return out
  }

  /**
   * Cached transactions in a date window. `net` is what the account actually
   * keeps; it is what the panel's own earnings figures are built from, so it is
   * what this CRM counts.
   */
  async transactions(ofUserId: string, since: string, until: string): Promise<OfTransaction[]> {
    const out: OfTransaction[] = []
    for (let offset = 0; offset < 200_000; offset += 200) {
      const json = await this.get<any>(
        `/accounts/${ofUserId}/transactions/cached?limit=200&offset=${offset}&since=${since}&until=${until}`,
      )
      const page: any[] = json?.list ?? []
      for (const t of page) {
        if (!t.id) continue
        out.push({
          txId: String(t.id),
          fanId: t.user?.id != null ? String(t.user.id) : null,
          ts: t.createdAt,
          grossCents: cents(t.amount),
          netCents: cents(t.net ?? t.amount),
          kind: t.descriptionDetails?.type ?? null,
        })
      }
      if (!json?.hasMore || page.length === 0) break
    }
    return out
  }

  /** Net earnings per day for one account, inclusive of both end dates. */
  async earningsByDay(
    ofUserId: string,
    startDate: string,
    endDate: string,
  ): Promise<OfEarningsDay[]> {
    const json = await this.get<any>(
      `/accounts/${ofUserId}/earnings?startDate=${startDate}&endDate=${endDate}`,
    )
    const total = json?.earnings?.total ?? {}
    const amounts: any[] = Array.isArray(total.chartAmount) ? total.chartAmount : []
    const counts = new Map<string, number>(
      (Array.isArray(total.chartCount) ? total.chartCount : []).map((c: any) => [
        String(c.date).slice(0, 10),
        Number(c.count ?? 0),
      ]),
    )
    return amounts.map((a) => {
      const day = String(a.date).slice(0, 10)
      return { day, netCents: cents(a.count), transactions: counts.get(day) ?? 0 }
    })
  }

  async earnings(period: OfPeriod): Promise<OfEarnings> {
    const j = await this.get<any>(`/earnings/summary?period=${period}`)
    const cat = j.by_category ?? {}
    return {
      period,
      totalCents: cents(j.total),
      prevTotalCents: cents(j.prev_total),
      byCategoryCents: {
        messages: cents(cat.messages),
        subscriptions: cents(cat.subscriptions),
        tips: cents(cat.tips),
        posts: cents(cat.posts),
        streams: cents(cat.streams),
        referrals: cents(cat.referrals),
      },
      transactions: Number(j.transactions_counted ?? 0),
      accountsCount: Number(j.accounts_count ?? 0),
      accountsNeverSynced: Number(j.accounts_never_synced ?? 0),
      chartDays: Array.isArray(j.chart_days) ? j.chart_days.map(String) : [],
      chartCents: Array.isArray(j.chart) ? j.chart.map(cents) : [],
    }
  }
}

let cached: TheOnlyApiClient | null = null

export function onlyApi(): TheOnlyApiClient | null {
  if (cached) return cached
  const key = process.env.ONLYAPI_KEY
  const crm = process.env.ONLYAPI_CRM_ID
  if (!key || !crm) return null
  cached = new TheOnlyApiClient(key, crm, process.env.ONLYAPI_BASE_URL)
  return cached
}

/** The dashboard's ranges, in the API's own vocabulary. */
export const PERIOD_FOR_RANGE: Record<string, OfPeriod> = {
  '24h': 'today',
  '7d': 'week',
  '30d': 'month',
}
