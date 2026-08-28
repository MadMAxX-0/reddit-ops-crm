import {
  RedditNotFound,
  RedditRateLimited,
  type AccountSnapshot,
  type PostSnapshot,
  type RedditProvider,
  type SubredditSnapshot,
} from './types'
import { backoffMs, limiterFor, sleep } from './rate-limit'
import { missingPost, toFullname, toPostSnapshot } from './reddit-json'

const BASE = 'https://www.reddit.com'
const DOMAIN = 'reddit.com'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

/**
 * Reads Reddit's public JSON endpoints. No credentials, no writes — this
 * product never posts to Reddit, it only observes.
 */
export class PublicRedditProvider implements RedditProvider {
  readonly name = 'reddit-public-json'

  constructor(
    private opts: {
      userAgent?: string
      ratePerMin?: number
      maxAttempts?: number
    } = {},
  ) {}

  private get limiter() {
    return limiterFor(DOMAIN, this.opts.ratePerMin ?? 55)
  }

  private async get(path: string): Promise<Json> {
    const attempts = this.opts.maxAttempts ?? 4
    let lastErr: unknown

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.limiter.acquire()
      try {
        const res = await fetch(`${BASE}${path}`, {
          headers: {
            'user-agent':
              this.opts.userAgent ??
              'reddit-ops-crm/1.0 (internal analytics; contact ops@example.com)',
            accept: 'application/json',
          },
          // never let one slow request stall the whole polling budget
          signal: AbortSignal.timeout(15_000),
        })

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? 0) * 1000 || 30_000
          this.limiter.penalise(retryAfter)
          throw new RedditRateLimited(retryAfter)
        }
        if (res.status === 404) throw new RedditNotFound(path)
        if (res.status >= 500) {
          this.limiter.penalise(5_000)
          throw new Error(`reddit ${res.status} on ${path}`)
        }
        if (!res.ok) throw new Error(`reddit ${res.status} on ${path}`)
        return await res.json()
      } catch (err) {
        lastErr = err
        if (err instanceof RedditNotFound) throw err
        if (attempt === attempts - 1) break
        await sleep(backoffMs(attempt))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  async getPost(id: string): Promise<PostSnapshot> {
    const fullname = toFullname(id)
    const json = await this.get(`/api/info.json?id=${fullname}&raw_json=1`)
    const child = json?.data?.children?.[0]?.data
    if (!child) {
      // a hard removal can vanish from the API entirely; report it rather than
      // throwing, so removal detection can act on it
      return missingPost(fullname)
    }
    return toPostSnapshot(child)
  }

  async getAccount(username: string): Promise<AccountSnapshot> {
    try {
      const json = await this.get(`/user/${encodeURIComponent(username)}/about.json?raw_json=1`)
      const d = json?.data
      if (!d)
        return {
          username,
          exists: false,
          suspended: false,
          karmaPost: 0,
          karmaComment: 0,
          followers: 0,
          createdAt: null,
        }
      return {
        username,
        exists: true,
        suspended: Boolean(d.is_suspended),
        karmaPost: d.link_karma ?? 0,
        karmaComment: d.comment_karma ?? 0,
        // the profile's own u_ subreddit, which is where followers live
        followers: d.subreddit?.subscribers ?? 0,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
      }
    } catch (err) {
      if (err instanceof RedditNotFound) {
        // 404 on /about is how a suspended or shadowbanned account reads
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
    try {
      const json = await this.get(`/r/${encodeURIComponent(name)}/about.json?raw_json=1`)
      const d = json?.data
      if (!d) throw new RedditNotFound(`r/${name}`)

      const text = `${d.description ?? ''}\n${d.public_description ?? ''}`
      return {
        name: d.display_name ?? name,
        exists: true,
        subscribers: d.subscribers ?? 0,
        isNsfw: Boolean(d.over18),
        verificationRequired: /verif/i.test(text),
        allowedFlairs: [],
        rulesSummary: (d.public_description ?? '').slice(0, 600) || null,
        private: d.subreddit_type === 'private',
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

  async listAccountSubmissions(
    username: string,
    since?: Date,
    _maxPages = 4,
  ): Promise<PostSnapshot[]> {
    const out: PostSnapshot[] = []
    let after: string | null = null

    // Page only as far back as `since` demands. On a hot account that is one
    // request; on a cold account being polled for the first time it is a few.
    for (let page = 0; page < 4; page++) {
      const qs = new URLSearchParams({ limit: '100', raw_json: '1', sort: 'new' })
      if (after) qs.set('after', after)
      let json: Json
      try {
        json = await this.get(`/user/${encodeURIComponent(username)}/submitted.json?${qs}`)
      } catch (err) {
        if (err instanceof RedditNotFound) return out
        throw err
      }
      const children: Json[] = json?.data?.children ?? []
      if (!children.length) break

      for (const c of children) {
        const post = toPostSnapshot(c.data)
        if (since && post.postedAt < since) return out
        out.push(post)
      }
      after = json?.data?.after ?? null
      if (!after) break
    }
    return out
  }

  async listSubredditNew(name: string, limit = 100): Promise<PostSnapshot[]> {
    const json = await this.get(`/r/${encodeURIComponent(name)}/new.json?limit=${limit}&raw_json=1`)
    return (json?.data?.children ?? []).map((c: Json) => toPostSnapshot(c.data))
  }
}
