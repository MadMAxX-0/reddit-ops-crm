import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type {
  AccountSnapshot,
  MediaKind,
  PostSnapshot,
  RedditProvider,
  SubredditSnapshot,
} from './types'

/**
 * A stand-in Reddit for local development and for proving the pipeline before
 * it is pointed at the real thing.
 *
 * It is not a mock in the test sense: it behaves like the source of truth the
 * scraper actually faces — posts appear on a timeline slightly after they were
 * made, scores follow a growth curve, mods remove things, accounts get
 * suspended. That is what makes discovery lag, removal detection and the
 * missed-post signal exercisable without touching reddit.com.
 *
 * Swap it out with REDDIT_PROVIDER=public.
 */
export class SimulatedRedditProvider implements RedditProvider {
  readonly name = 'simulated'

  constructor(
    private opts: {
      /** chance an account produces a fresh post on any given poll */
      newPostChance?: number
      /** chance a live post is removed between polls */
      removalChance?: number
      seed?: string
    } = {},
  ) {}

  /** deterministic 0..1 from any string, so repeated polls agree with themselves */
  private hash01(s: string): number {
    const h = crypto
      .createHash('sha256')
      .update(`${this.opts.seed ?? ''}${s}`)
      .digest()
    return h.readUInt32BE(0) / 0xffffffff
  }

  /** the score this post is heading toward, fixed for its whole life */
  private peakFor(postId: string): number {
    return Math.max(1, Math.round(Math.exp(2.3 + this.hash01(`peak:${postId}`) * 3.6)))
  }

  private scoreAt(postId: string, postedAt: Date, at = new Date()): number {
    const hours = Math.max(0, (at.getTime() - postedAt.getTime()) / 3_600_000)
    const tau = 1.5 + this.hash01(`tau:${postId}`) * 5
    return Math.max(1, Math.round(this.peakFor(postId) * (1 - Math.exp(-hours / tau))))
  }

  async getPost(id: string): Promise<PostSnapshot> {
    const post = await prisma.post.findUnique({
      where: { redditPostId: id },
      include: { subreddit: true, redditAccount: true },
    })
    if (!post) {
      return {
        redditPostId: id,
        author: '',
        subreddit: '',
        title: '',
        flair: null,
        mediaType: 'IMAGE',
        url: '',
        postedAt: new Date(0),
        upvotes: 0,
        upvoteRatio: 0,
        comments: 0,
        removed: true,
        deleted: false,
        removalReason: 'not returned by api',
        mediaUrl: null,
        thumbnailUrl: null,
        selftext: null,
        missing: true,
      }
    }

    const alreadyGone = post.status === 'REMOVED' || post.status === 'DELETED'
    // young posts in risky subs are the ones that get pulled
    const ageH = (Date.now() - post.postedAt.getTime()) / 3_600_000
    const riskWindow = ageH < 24
    const removalChance =
      this.opts.removalChance ?? (post.subreddit.status === 'RISKY' ? 0.05 : 0.012)
    const removedNow =
      alreadyGone ||
      (riskWindow && this.hash01(`rm:${post.redditPostId}:${Math.floor(ageH)}`) < removalChance)

    const upvotes = removedNow && alreadyGone ? 1 : this.scoreAt(post.redditPostId, post.postedAt)

    return {
      redditPostId: post.redditPostId,
      author: post.redditAccount.username,
      subreddit: post.subreddit.name,
      title: post.title,
      mediaUrl: null,
      thumbnailUrl: null,
      selftext: null,
      flair: post.flair,
      mediaType: post.mediaType as MediaKind,
      url: post.url ?? '',
      postedAt: post.postedAt,
      upvotes,
      upvoteRatio: Number((0.72 + this.hash01(`ratio:${post.redditPostId}`) * 0.26).toFixed(2)),
      comments: Math.round(upvotes * (0.02 + this.hash01(`c:${post.redditPostId}`) * 0.08)),
      removed: removedNow,
      deleted: post.status === 'DELETED',
      removalReason: removedNow
        ? (post.removalReason ?? 'Rule 3 — promotional link in title')
        : null,
    }
  }

  async getAccount(username: string): Promise<AccountSnapshot> {
    const account = await prisma.redditAccount.findUnique({ where: { username } })
    if (!account) {
      return {
        username,
        exists: false,
        suspended: false,
        karmaPost: 0,
        karmaComment: 0,
        followers: 0,
        createdAt: null,
      }
    }
    const suspended =
      account.status === 'SUSPENDED' ||
      this.hash01(`susp:${username}:${new Date().toISOString().slice(0, 10)}`) < 0.002
    // Karma drifts with elapsed time, not per call. A flat bump on every poll
    // would make the health job think every account had a missed post.
    const daysSinceCheck = account.lastCheckedAt
      ? (Date.now() - account.lastCheckedAt.getTime()) / 86_400_000
      : 1
    const drift = suspended ? 0 : Math.round(daysSinceCheck * this.hash01(`karma:${username}`) * 4)
    // Followers accrue far slower than karma and never fall, so they drift on
    // their own curve rather than as a ratio of karma.
    const followerDrift = suspended
      ? 0
      : Math.round(daysSinceCheck * this.hash01(`followers:${username}`) * 12)
    return {
      username,
      exists: !suspended,
      suspended,
      karmaPost: account.karmaPost + drift,
      karmaComment: account.karmaComment + Math.round(drift / 2),
      followers: account.followers + followerDrift,
      createdAt: account.redditCreatedAt,
    }
  }

  async getSubreddit(name: string): Promise<SubredditSnapshot> {
    const sub = await prisma.subreddit.findUnique({ where: { name } })
    if (!sub) {
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
    // subscriber counts wander; the weekly job is what notices a sub going quiet
    const wobble =
      1 + (this.hash01(`subs:${name}:${new Date().toISOString().slice(0, 10)}`) - 0.45) * 0.02
    return {
      name: sub.name,
      exists: true,
      subscribers: Math.round(sub.subscribers * wobble),
      isNsfw: sub.isNsfw,
      verificationRequired: sub.verificationRequired,
      allowedFlairs: sub.allowedFlairs,
      rulesSummary: sub.rulesSummary,
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

  async listAccountSubmissions(
    username: string,
    since?: Date,
    _maxPages = 4,
  ): Promise<PostSnapshot[]> {
    const account = await prisma.redditAccount.findUnique({
      where: { username },
      include: { assignments: { where: { endedAt: null }, take: 1 } },
    })
    if (!account || account.status === 'SUSPENDED') return []

    const known = await prisma.post.findMany({
      where: { redditAccountId: account.id, ...(since ? { postedAt: { gte: since } } : {}) },
      orderBy: { postedAt: 'desc' },
      take: 100,
      include: { subreddit: true },
    })

    const out: PostSnapshot[] = []
    for (const p of known) {
      out.push(await this.getPost(p.redditPostId))
    }

    // Occasionally the account has posted something we have never seen. This is
    // the row discovery is supposed to find and insert.
    const posting = account.status === 'ACTIVE' && account.assignments.length > 0
    const chance = this.opts.newPostChance ?? (posting ? 0.35 : 0.02)
    const bucket = Math.floor(Date.now() / (10 * 60_000)) // stable within a poll window
    if (posting && this.hash01(`new:${username}:${bucket}`) < chance) {
      const subs = await prisma.subreddit.findMany({ where: { status: 'ACTIVE' }, take: 40 })
      if (subs.length) {
        const sub = subs[Math.floor(this.hash01(`sub:${username}:${bucket}`) * subs.length)]
        // posted somewhere inside the last polling window, so discovery lag is
        // a realistic few minutes rather than zero
        const minutesAgo = 1 + Math.floor(this.hash01(`lag:${username}:${bucket}`) * 9)
        const postedAt = new Date(Date.now() - minutesAgo * 60_000)
        const redditPostId = `t3_sim${crypto
          .createHash('sha1')
          .update(`${username}:${bucket}`)
          .digest('hex')
          .slice(0, 9)}`
        out.unshift({
          redditPostId,
          author: username,
          subreddit: sub.name,
          title: SIM_TITLES[Math.floor(this.hash01(`t:${redditPostId}`) * SIM_TITLES.length)],
          flair: sub.allowedFlairs[0] ?? null,
          mediaType: 'IMAGE',
          url: `https://reddit.com/r/${sub.name}/comments/${redditPostId.slice(3)}/`,
          postedAt,
          upvotes: this.scoreAt(redditPostId, postedAt),
          upvoteRatio: 0.94,
          comments: 0,
          removed: false,
          deleted: false,
          removalReason: null,
          mediaUrl: null,
          thumbnailUrl: null,
          selftext: null,
        })
      }
    }

    return out
  }

  async listSubredditNew(name: string, limit = 100): Promise<PostSnapshot[]> {
    const sub = await prisma.subreddit.findUnique({ where: { name } })
    if (!sub) return []
    const posts = await prisma.post.findMany({
      where: {
        subredditId: sub.id,
        status: 'LIVE',
        // a shadowbanned account's posts are visible on its own profile but
        // never appear in the subreddit listing — that asymmetry is the test
        redditAccount: { shadowbanned: false },
      },
      orderBy: { postedAt: 'desc' },
      take: limit,
    })
    return Promise.all(posts.map((p) => this.getPost(p.redditPostId)))
  }
}

const SIM_TITLES = [
  'first time posting here, be nice 🙈',
  'do you think I could pull off this outfit?',
  'free page in bio, no card needed 💕',
  'quick one before my shift',
  'be honest — would you swipe?',
  'trying something new tonight',
]
