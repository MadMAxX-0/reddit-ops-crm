import {
  RedditNotFound,
  RedditRateLimited,
  type AccountSnapshot,
  type PostSnapshot,
  type RedditProvider,
  type OverviewItem,
  type SubredditRuleSnapshot,
  type SubredditSnapshot,
} from './types'
import { backoffMs, limiterFor, sleep } from './rate-limit'
import {
  REDDIT_BASE,
  bareId,
  missingPost,
  toFullname,
  toPostSnapshot,
  type RedditT3,
} from './reddit-json'

const DOMAIN = 'rapidapi.com'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Envelope = { success: boolean; data: any }

/**
 * Reddit via RapidAPI (default host `reddit34.p.rapidapi.com`).
 *
 * The payloads are Reddit's own `t3` link objects wrapped one level down, so
 * the mapping is shared with the direct provider — only transport, auth and
 * pagination differ.
 *
 * Two things about this host are worth knowing before trusting its output:
 *
 *  1. There is no account-suspension flag. A suspended account, a deleted
 *     account and a typo all come back as `success:false, "user not found"`.
 *     `exists:false` is reported honestly; the health job is what decides
 *     whether that means suspended, and it should not be treated as certain.
 *
 *  2. Requests are metered monthly, not per-second. The quota is read off the
 *     response headers after every call and exposed via `quota()` so the
 *     Scraper page can show how much budget is left rather than discovering the
 *     ceiling by hitting it.
 */
export class RapidApiRedditProvider implements RedditProvider {
  readonly name: string

  private quotaLimit: number | null = null
  private quotaRemaining: number | null = null
  private quotaResetAt: Date | null = null

  constructor(
    private opts: {
      apiKey: string
      host?: string
      ratePerMin?: number
      maxAttempts?: number
    },
  ) {
    this.name = `rapidapi:${opts.host ?? 'reddit34.p.rapidapi.com'}`
  }

  private get host() {
    return this.opts.host ?? 'reddit34.p.rapidapi.com'
  }

  private get limiter() {
    return limiterFor(DOMAIN, this.opts.ratePerMin ?? 60)
  }

  /** Monthly request budget as last reported by the API. */
  quota() {
    return {
      limit: this.quotaLimit,
      remaining: this.quotaRemaining,
      resetAt: this.quotaResetAt,
    }
  }

  private async get(path: string): Promise<Envelope> {
    const attempts = this.opts.maxAttempts ?? 4
    let lastErr: unknown

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.limiter.acquire()
      try {
        const res = await fetch(`https://${this.host}${path}`, {
          headers: {
            'x-rapidapi-key': this.opts.apiKey,
            'x-rapidapi-host': this.host,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(20_000),
        })

        this.readQuota(res.headers)

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? 0) * 1000 || 60_000
          this.limiter.penalise(retryAfter)
          throw new RedditRateLimited(retryAfter)
        }
        if (res.status === 403) {
          // wrong key, or the key is not subscribed to this host. Retrying will
          // never fix either, so fail loudly instead of burning the budget.
          throw new Error(`rapidapi 403 on ${this.host}${path} — key not subscribed or invalid`)
        }
        if (res.status === 404) throw new RedditNotFound(path)
        if (res.status >= 500) {
          this.limiter.penalise(5_000)
          throw new Error(`rapidapi ${res.status} on ${path}`)
        }
        if (!res.ok) throw new Error(`rapidapi ${res.status} on ${path}`)

        return (await res.json()) as Envelope
      } catch (err) {
        lastErr = err
        if (err instanceof RedditNotFound) throw err
        if (err instanceof Error && err.message.includes('403')) throw err
        if (attempt === attempts - 1) break
        await sleep(backoffMs(attempt))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  private readQuota(headers: Headers) {
    const limit = Number(headers.get('x-ratelimit-requests-limit'))
    const remaining = Number(headers.get('x-ratelimit-requests-remaining'))
    const reset = Number(headers.get('x-ratelimit-requests-reset'))
    if (Number.isFinite(limit) && limit > 0) this.quotaLimit = limit
    if (Number.isFinite(remaining)) this.quotaRemaining = remaining
    if (Number.isFinite(reset) && reset > 0) {
      this.quotaResetAt = new Date(Date.now() + reset * 1000)
    }
  }

  /** Posts arrive as `[{ data: t3 }]`; some endpoints return a bare t3 array. */
  private unwrapPosts(data: any): PostSnapshot[] {
    const list: RedditT3[] = data?.posts ?? data ?? []
    if (!Array.isArray(list)) return []
    return list.map((entry) => toPostSnapshot(entry?.data ?? entry)).filter((p) => p.redditPostId)
  }

  async getPost(id: string): Promise<PostSnapshot> {
    const fullname = toFullname(id)
    // This host keys post lookups by URL, not by fullname. The short
    // /comments/<id> form resolves server-side, so we never have to store or
    // reconstruct a full permalink to re-check a post.
    const url = `${REDDIT_BASE}/comments/${bareId(fullname)}`
    try {
      const json = await this.get(`/getPostDetails?post_url=${encodeURIComponent(url)}`)
      if (!json.success || !json.data) return missingPost(fullname)
      return toPostSnapshot(json.data)
    } catch (err) {
      if (err instanceof RedditNotFound) return missingPost(fullname)
      throw err
    }
  }

  async getAccount(username: string): Promise<AccountSnapshot> {
    try {
      const json = await this.get(`/getProfile?username=${encodeURIComponent(username)}`)
      const d = json.data
      if (!json.success || !d || typeof d === 'string') {
        // "user not found" — suspended, deleted or never existed. This host
        // cannot tell us which, so we report the ambiguity rather than
        // inventing a suspension.
        return {
          username,
          exists: false,
          suspended: true,
          karmaPost: 0,
          karmaComment: 0,
          followers: 0,
          createdAt: null,
        }
      }
      return {
        username,
        exists: true,
        suspended: Boolean(d.is_suspended),
        karmaPost: d.link_karma ?? 0,
        karmaComment: d.comment_karma ?? 0,
        // this host passes Reddit's shape through, but has been seen to drop
        // the nested subreddit object; 0 here means "not reported", not "none"
        followers: d.subreddit?.subscribers ?? 0,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
      }
    } catch (err) {
      if (err instanceof RedditNotFound) {
        return {
          username,
          exists: false,
          suspended: true,
          karmaPost: 0,
          karmaComment: 0,
          followers: 0,
          createdAt: null,
        }
      }
      throw err
    }
  }

  async getSubreddit(name: string): Promise<SubredditSnapshot> {
    const absent: SubredditSnapshot = {
      name,
      exists: false,
      subscribers: 0,
      isNsfw: false,
      verificationRequired: false,
      allowedFlairs: [],
      rulesSummary: null,
      private: false,
      submissionType: null,
      allowsImages: null,
      allowsVideos: null,
      allowsGalleries: null,
      restrictedPosting: null,
      subredditType: null,
      quarantined: null,
      createdAt: null,
      submitText: null,
    }
    try {
      const json = await this.get(`/getSubredditInfo?subreddit=${encodeURIComponent(name)}`)
      const d = json.data
      if (!json.success || !d || typeof d === 'string') return absent

      const text = `${d.description ?? ''}\n${d.public_description ?? ''}`
      return {
        name: d.display_name ?? name,
        exists: true,
        subscribers: d.subscribers ?? 0,
        isNsfw: Boolean(d.over18),
        verificationRequired: /verif/i.test(text),
        allowedFlairs: [],
        rulesSummary: (d.public_description ?? '').slice(0, 600) || null,
        private: d.subreddit_type === 'private' || d.subreddit_type === 'restricted',
        submissionType: d.submission_type ?? null,
        allowsImages: typeof d.allow_images === 'boolean' ? d.allow_images : null,
        allowsVideos: typeof d.allow_videos === 'boolean' ? d.allow_videos : null,
        allowsGalleries: typeof d.allow_galleries === 'boolean' ? d.allow_galleries : null,
        restrictedPosting: typeof d.restrict_posting === 'boolean' ? d.restrict_posting : null,
        subredditType: d.subreddit_type ?? null,
        quarantined: typeof d.quarantine === 'boolean' ? d.quarantine : null,
        // Reddit sends seconds; everything downstream expects milliseconds.
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
        submitText: (d.submit_text ?? '').slice(0, 1000) || null,
      }
    } catch (err) {
      if (err instanceof RedditNotFound) return absent
      throw err
    }
  }

  /**
   * Ask again, spaced out, when a first page comes back empty. Four extra
   * attempts because the observed failure runs in streaks: five zeroes then a
   * full page. It costs nothing on a healthy account — this only runs when the
   * answer was empty, and an account with no posts costs four cheap calls once
   * per poll rather than a permanently missing history.
   */
  private async retryFirstPage(username: string): Promise<PostSnapshot[]> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 1_200))
      try {
        const qs = new URLSearchParams({ username, sort: 'new' })
        const json = await this.get(`/getPostsByUsername?${qs}`)
        if (!json.success) continue
        const batch = this.unwrapPosts(json.data)
        if (batch.length) return batch
      } catch {
        // a failed attempt is not evidence of an empty timeline
      }
    }
    return []
  }

  async listAccountSubmissions(
    username: string,
    since?: Date,
    maxPages = 4,
  ): Promise<PostSnapshot[]> {
    const out: PostSnapshot[] = []
    let cursor: string | null = null

    // Page only as far back as `since` demands. On a hot account that is one
    // request. A history walk passes no `since` and a higher page budget, so it
    // runs until the cursor dries up rather than until a date is crossed.
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ username, sort: 'new' })
      if (cursor) qs.set('cursor', cursor)

      let json: Envelope
      try {
        json = await this.get(`/getPostsByUsername?${qs}`)
      } catch (err) {
        if (err instanceof RedditNotFound) return out
        throw err
      }
      if (!json.success) return out

      const batch = this.unwrapPosts(json.data)
      if (!batch.length) {
        // An empty timeline is not an empty account. This host answers
        // `success: true` with zero posts for accounts that are posting
        // several times a day — one account returned 0 on five
        // consecutive calls and 20 on the sixth, including five posts made
        // that morning. Treating the first empty answer as truth is what
        // froze the post counts.
        //
        // Only the FIRST page retries: an empty page after real results is
        // the end of the timeline, which is a different thing.
        if (page === 0) {
          const recovered = await this.retryFirstPage(username)
          if (recovered.length) {
            for (const post of recovered) {
              if (since && post.postedAt < since) return out
              out.push(post)
            }
            cursor = null
            break
          }
        }
        break
      }

      for (const post of batch) {
        if (since && post.postedAt < since) return out
        out.push(post)
      }

      cursor = json.data?.cursor ?? null
      if (!cursor) break
    }
    return out
  }

  /**
   * The rules a subreddit publishes. Undocumented on this host and found by
   * probing endpoint names, not by reading a spec — there is no spec. It is the
   * only source for karma floors, verification and OC rules, which are the
   * facts that decide whether an account may post at all.
   */
  async getSubredditRules(name: string): Promise<SubredditRuleSnapshot[]> {
    try {
      const json = await this.get(`/getSubredditRules?subreddit=${encodeURIComponent(name)}`)
      const rules = json?.data?.rules
      if (!json.success || !Array.isArray(rules)) return []
      return rules.map((r: Record<string, unknown>) => ({
        shortName: String(r.short_name ?? ''),
        description: String(r.description ?? ''),
        violationReason: r.violation_reason ? String(r.violation_reason) : null,
      }))
    } catch (err) {
      if (err instanceof RedditNotFound) return []
      throw err
    }
  }

  /**
   * Everything the account has done recently, posts and comments alike.
   *
   * `getPostsByUsername` truncates hard — u/SableSizzle has 1.27M link karma and
   * that endpoint returns a single row — so discovery built on it alone reads a
   * busy account as dead. This endpoint returned 25 items across nine
   * subreddits for the same account.
   */
  async getUserOverview(username: string): Promise<OverviewItem[]> {
    try {
      const json = await this.get(
        `/getUserOverview?username=${encodeURIComponent(username)}&sort=new`,
      )
      const items = json?.data?.items
      if (!json.success || !Array.isArray(items)) return []
      return items
        .map((entry: { data?: Record<string, unknown> }) => {
          const d = (entry?.data ?? entry) as Record<string, unknown>
          const subreddit = typeof d.subreddit === 'string' ? d.subreddit : ''
          if (!subreddit) return null
          return {
            subreddit,
            // a comment carries no title; that is the only reliable separator here
            isPost: d.title != null,
            score: typeof d.score === 'number' ? d.score : 0,
            createdAt: new Date(Number(d.created_utc ?? 0) * 1000),
          }
        })
        .filter((x): x is OverviewItem => x !== null)
    } catch (err) {
      if (err instanceof RedditNotFound) return []
      throw err
    }
  }

  async listSubredditNew(name: string, limit = 100): Promise<PostSnapshot[]> {
    try {
      const json = await this.get(
        `/getPostsBySubreddit?subreddit=${encodeURIComponent(name)}&sort=new`,
      )
      if (!json.success) return []
      return this.unwrapPosts(json.data).slice(0, limit)
    } catch (err) {
      if (err instanceof RedditNotFound) return []
      throw err
    }
  }
}
