import type { MediaKind, PostSnapshot } from './types'

/**
 * Reddit's own `t3` link object, and how it maps to a PostSnapshot.
 *
 * Shared because more than one provider serves this exact shape: reddit.com's
 * public JSON returns it directly, and the RapidAPI wrappers return it nested
 * one level down. Mapping it twice is how the two providers quietly drift into
 * disagreeing about what "removed" means.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RedditT3 = any

export const REDDIT_BASE = 'https://www.reddit.com'

export function mediaKind(d: RedditT3): MediaKind {
  if (d.is_gallery) return 'GALLERY'
  if (d.is_video || d.post_hint === 'hosted:video' || d.post_hint === 'rich:video') return 'VIDEO'
  if (d.post_hint === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(d.url ?? '')) return 'IMAGE'
  if (d.is_self) return 'TEXT'
  return 'LINK'
}

/**
 * Reddit's own preview, unescaped.
 *
 * `thumbnail` is a placeholder word — "nsfw", "self", "default", "spoiler" —
 * far more often than it is a URL, and on this agency's posts it is "nsfw"
 * nearly every time. The preview block still carries a real image in those
 * cases, so it is tried first and the thumbnail only stands in behind it.
 * Reddit HTML-escapes the ampersands in these URLs and they 404 until decoded.
 */
function previewUrl(d: RedditT3): string | null {
  const raw =
    d?.preview?.images?.[0]?.resolutions?.slice(-1)?.[0]?.url ??
    d?.preview?.images?.[0]?.source?.url ??
    (typeof d?.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : null)
  return raw ? String(raw).replace(/&amp;/g, '&') : null
}

/** The media a post points at, when the post IS the media rather than a link out. */
function mediaUrl(d: RedditT3): string | null {
  const kind = mediaKind(d)
  if (kind === 'TEXT') return null
  if (d?.is_video && d?.media?.reddit_video?.fallback_url) {
    return String(d.media.reddit_video.fallback_url).replace(/&amp;/g, '&')
  }
  const u = d?.url_overridden_by_dest ?? d?.url
  return typeof u === 'string' && /^https?:/.test(u) ? u.replace(/&amp;/g, '&') : null
}

export function toPostSnapshot(d: RedditT3): PostSnapshot {
  // Reddit signals removal in several places and none of them alone is enough:
  // a mod removal sets removed_by_category, an author delete blanks the author,
  // and automod filtering shows up only as a [removed] selftext.
  const removedByMod =
    Boolean(d.removed_by_category && d.removed_by_category !== 'deleted') ||
    d.selftext === '[removed]' ||
    d.banned_by != null
  const deletedByAuthor =
    d.removed_by_category === 'deleted' || d.author === '[deleted]' || d.selftext === '[deleted]'

  return {
    redditPostId: d.name ?? `t3_${d.id}`,
    author: d.author,
    subreddit: d.subreddit,
    title: d.title ?? '',
    flair: d.link_flair_text ?? null,
    mediaType: mediaKind(d),
    url: d.permalink ? `${REDDIT_BASE}${d.permalink}` : (d.url ?? ''),
    mediaUrl: mediaUrl(d),
    thumbnailUrl: previewUrl(d),
    selftext:
      typeof d.selftext === 'string' && d.selftext && !/^\[(removed|deleted)\]$/.test(d.selftext)
        ? d.selftext.slice(0, 500)
        : null,
    postedAt: new Date((d.created_utc ?? 0) * 1000),
    upvotes: d.score ?? 0,
    upvoteRatio: d.upvote_ratio ?? 0,
    comments: d.num_comments ?? 0,
    removed: removedByMod,
    deleted: deletedByAuthor,
    removalReason: d.removed_by_category ?? (removedByMod ? 'removed' : null),
  }
}

/** A post that the API will not return at all — usually a hard removal. */
export function missingPost(fullname: string): PostSnapshot {
  return {
    redditPostId: fullname,
    author: '',
    subreddit: '',
    title: '',
    flair: null,
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    selftext: null,
    url: '',
    postedAt: new Date(0),
    upvotes: 0,
    upvoteRatio: 0,
    comments: 0,
    removed: true,
    deleted: false,
    removalReason: 'not returned by api',
    missing: true,
  }
}

export function toFullname(id: string): string {
  return id.startsWith('t3_') ? id : `t3_${id}`
}

export function bareId(id: string): string {
  return id.replace(/^t3_/, '')
}
