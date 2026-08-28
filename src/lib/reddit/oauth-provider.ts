import { toPostSnapshot } from './reddit-json'
import { DomainLimiter } from './rate-limit'
import {
  RedditNotFound,
  RedditRateLimited,
  type AccountSnapshot,
  type OverviewItem,
  type PostSnapshot,
  type RedditProvider,
  type SubredditRuleSnapshot,
  type SubredditSnapshot,
} from './types'

/**
 * Reddit's own API, over OAuth.
 *
 * This exists because the third-party host cannot be relied on to list posts.
 * It answers `success: true` with an empty array for accounts that are posting
 * several times a day, in streaks lasting tens of minutes — one account
 * returned zero on five consecutive calls, twenty on the sixth (including five
 * posts made that morning), then zero again for the next twenty minutes. There
 * is no header, sort order or retry pattern that changes it. Reddit's own
 * endpoints have no such behaviour.
 *
 * Requires a "script" app from https://www.reddit.com/prefs/apps:
 *
 *   REDDIT_CLIENT_ID       the string under the app name
 *   REDDIT_CLIENT_SECRET   the "secret" field
 *   REDDIT_USERNAME        the Reddit account the app belongs to
 *   REDDIT_PASSWORD        that account's password
 *   REDDIT_USER_AGENT      e.g. "macos:reddit-ops-crm:1.0 (by /u/yourname)"
 *
 * The linked account must be 18+ with "show NSFW content" enabled in its
 * preferences, or Reddit filters adult subreddits out of every listing — which
 * would reproduce the exact problem this is here to solve.
 */
interface OAuthOpts {
  clientId: string
  clientSecret: string
  username: string
  password: string
  userAgent: string
  ratePerMin?: number
}

interface Listing {
  data?: {
    after?: string | null
    children?: Array<{ kind?: string; data?: Record<string, unknown> }>
  }
}

export class OAuthRedditProvider implements RedditProvider {
  readonly name = 'reddit:oauth'
  private limiter: DomainLimiter
  private token: { value: string; expiresAt: number } | null = null

  constructor(private opts: OAuthOpts) {
    // Reddit allows 100 requests/minute averaged over 10 minutes for OAuth
    // clients. 90 leaves headroom for the token refresh and for two processes
    // (the app and the worker) sharing one credential.
    this.limiter = new DomainLimiter('oauth.reddit.com', opts.ratePerMin ?? 90)
  }

  /** Password grant: a script app acting as its own owner. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value

    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64')
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.opts.userAgent,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.opts.username,
        password: this.opts.password,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      throw new Error(
        `Reddit token request failed: ${res.status} ${res.statusText}. ` +
          'Check the client id/secret, that the app type is "script", and that ' +
          'the account has no 2FA (a script app cannot answer a 2FA prompt).',
      )
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error('Reddit returned no access_token')
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    }
    return this.token.value
  }

  private async get<T>(path: string): Promise<T> {
    await this.limiter.acquire()
    const token = await this.accessToken()
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': this.opts.userAgent,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 0) * 1000 || 60_000
      this.limiter.penalise(retryAfter)
      throw new RedditRateLimited(retryAfter)
    }
    if (res.status === 401) {
      // token rejected mid-flight: drop it so the next call re-authenticates
      this.token = null
      throw new Error('Reddit rejected the token (401)')
    }
    if (res.status === 404) throw new RedditNotFound(path)
    if (!res.ok) throw new Error(`Reddit ${res.status} on ${path}`)
    return (await res.json()) as T
  }

  private children(listing: Listing) {
    return (listing.data?.children ?? []).map((c) => ({ kind: c.kind, data: c.data ?? {} }))
  }

  async getAccount(username: string): Promise<AccountSnapshot> {
    try {
      const json = await this.get<{ data?: Record<string, any> }>(
        `/user/${encodeURIComponent(username)}/about`,
      )
      const d = json.data ?? {}
      return {
        username: d.name ?? username,
        exists: true,
        suspended: Boolean(d.is_suspended),
        karmaPost: d.link_karma ?? 0,
        karmaComment: d.comment_karma ?? 0,
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

  /**
   * The whole point of this provider. Reddit paginates with `after`, returns a
   * full 100 per page, and does not answer empty for an account that has posts.
   */
  async listAccountSubmissions(
    username: string,
    since?: Date,
    maxPages = 4,
  ): Promise<PostSnapshot[]> {
    const out: PostSnapshot[] = []
    let after: string | null = null

    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ limit: '100', raw_json: '1' })
      if (after) qs.set('after', after)
      let listing: Listing
      try {
        listing = await this.get<Listing>(`/user/${encodeURIComponent(username)}/submitted?${qs}`)
      } catch (err) {
        if (err instanceof RedditNotFound) return out
        throw err
      }

      const batch = this.children(listing).filter((c) => c.kind === 't3')
      if (!batch.length) break

      for (const c of batch) {
        const snap = toPostSnapshot(c.data as never)
        if (!snap.redditPostId) continue
        if (since && snap.postedAt < since) return out
        out.push(snap)
      }

      after = listing.data?.after ?? null
      if (!after) break
    }
    return out
  }

  async getUserOverview(username: string): Promise<OverviewItem[]> {
    const listing = await this.get<Listing>(
      `/user/${encodeURIComponent(username)}/overview?limit=100&raw_json=1`,
    )
    return this.children(listing).map((c) => ({
      subreddit: String(c.data.subreddit ?? ''),
      isPost: c.kind === 't3',
      score: Number(c.data.score ?? 0),
      createdAt: new Date(Number(c.data.created_utc ?? 0) * 1000),
    }))
  }

  async getPost(id: string): Promise<PostSnapshot> {
    const fullname = id.startsWith('t3_') ? id : `t3_${id}`
    const listing = await this.get<Listing>(`/api/info?id=${fullname}&raw_json=1`)
    const first = this.children(listing)[0]
    if (!first) {
      return toPostSnapshot({ name: fullname, removed_by_category: null } as never)
    }
    return toPostSnapshot(first.data as never)
  }

  async getSubreddit(name: string): Promise<SubredditSnapshot> {
    try {
      const json = await this.get<{ data?: Record<string, any> }>(
        `/r/${encodeURIComponent(name)}/about`,
      )
      const d = json.data ?? {}
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
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
        submitText: (d.submit_text ?? '').slice(0, 1000) || null,
      }
    } catch (err) {
      if (err instanceof RedditNotFound) {
        return {
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
      }
      throw err
    }
  }

  async getSubredditRules(name: string): Promise<SubredditRuleSnapshot[]> {
    try {
      const json = await this.get<{ rules?: Array<Record<string, any>> }>(
        `/r/${encodeURIComponent(name)}/about/rules`,
      )
      return (json.rules ?? []).map((r) => ({
        shortName: String(r.short_name ?? ''),
        description: String(r.description ?? ''),
        violationReason: r.violation_reason ? String(r.violation_reason) : null,
      }))
    } catch {
      return []
    }
  }

  async listSubredditNew(name: string, limit = 100): Promise<PostSnapshot[]> {
    const listing = await this.get<Listing>(
      `/r/${encodeURIComponent(name)}/new?limit=${limit}&raw_json=1`,
    )
    return this.children(listing)
      .filter((c) => c.kind === 't3')
      .map((c) => toPostSnapshot(c.data as never))
      .filter((p) => p.redditPostId)
  }
}
