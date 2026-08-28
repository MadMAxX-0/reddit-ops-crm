/**
 * The provider boundary. Everything downstream of ingestion speaks these
 * shapes and nothing else, so the data source can be swapped — public JSON,
 * an authenticated API, a third-party scraper — without touching the app.
 */

export type MediaKind = 'IMAGE' | 'VIDEO' | 'GALLERY' | 'LINK' | 'TEXT'

export interface PostSnapshot {
  redditPostId: string
  author: string
  subreddit: string
  title: string
  flair: string | null
  mediaType: MediaKind
  url: string
  /** the media itself — i.redd.it and friends — not the permalink */
  mediaUrl: string | null
  /** Reddit's own preview, when it offers one that is not a placeholder */
  thumbnailUrl: string | null
  /** the body of a self post, trimmed */
  selftext: string | null
  postedAt: Date
  upvotes: number
  upvoteRatio: number
  comments: number
  /** removed by a moderator or automod */
  removed: boolean
  /** deleted by the author */
  deleted: boolean
  removalReason: string | null
  /** absent from the API entirely — a 404, which usually means removed hard */
  missing?: boolean
}

export interface AccountSnapshot {
  username: string
  exists: boolean
  suspended: boolean
  karmaPost: number
  karmaComment: number
  /**
   * Profile followers. A Reddit profile is backed by a hidden `u_<name>`
   * subreddit, and its subscriber count is the follower count. Providers that
   * cannot see it report 0 — callers must not read 0 as "lost every follower",
   * which is why the health job only ever writes a non-zero value.
   */
  followers: number
  createdAt: Date | null
}

export interface SubredditSnapshot {
  name: string
  exists: boolean
  subscribers: number
  isNsfw: boolean
  /** true when the sub demands a verification post before submissions */
  verificationRequired: boolean
  allowedFlairs: string[]
  rulesSummary: string | null
  private: boolean
  /** what the sub will physically accept — Reddit's own switches, not prose */
  submissionType: string | null
  allowsImages: boolean | null
  allowsVideos: boolean | null
  allowsGalleries: boolean | null
  restrictedPosting: boolean | null
  subredditType: string | null
  quarantined: boolean | null
  createdAt: Date | null
  submitText: string | null
}

/** A post or a comment, as it appears on a user's overview. */
export interface OverviewItem {
  subreddit: string
  isPost: boolean
  score: number
  createdAt: Date
}

/** One rule as the subreddit's moderators wrote it. */
export interface SubredditRuleSnapshot {
  shortName: string
  description: string
  violationReason: string | null
}

export interface RedditProvider {
  readonly name: string
  getPost(id: string): Promise<PostSnapshot>
  /** the subreddit's own rule list, empty when it publishes none */
  getSubredditRules?(name: string): Promise<SubredditRuleSnapshot[]>
  /**
   * Posts AND comments together. The submission listing is heavily truncated on
   * some accounts — one row for an account with a million link karma — and this
   * is the only endpoint that shows where they are actually active.
   */
  getUserOverview?(username: string): Promise<OverviewItem[]>
  getAccount(username: string): Promise<AccountSnapshot>
  getSubreddit(name: string): Promise<SubredditSnapshot>
  /**
   * The primary discovery loop. Returns the account's own submissions, newest
   * first. `since` is a hint — providers may return more, callers must diff.
   */
  /** `maxPages` only matters when `since` is absent — a full history walk. */
  listAccountSubmissions(username: string, since?: Date, maxPages?: number): Promise<PostSnapshot[]>
  /**
   * A subreddit's /new listing. Used for shadowban detection: if an account's
   * own post is visible on its profile but absent here, it is shadowbanned.
   */
  listSubredditNew?(name: string, limit?: number): Promise<PostSnapshot[]>
}

export class RedditRateLimited extends Error {
  constructor(public retryAfterMs: number) {
    super(`Reddit rate limited, retry in ${Math.round(retryAfterMs / 1000)}s`)
    this.name = 'RedditRateLimited'
  }
}

export class RedditNotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'RedditNotFound'
  }
}
