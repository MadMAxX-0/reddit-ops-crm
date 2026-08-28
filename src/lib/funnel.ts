import { prisma } from '@/lib/prisma'
import { privacyHash } from '@/lib/crypto'
import type { AttributionType } from '@/generated/prisma/client'

/**
 * The funnel page IS the tracking layer — there is no separate redirector.
 *
 *   Reddit post → bio link      funnel.com/{slug}       FunnelEvent: LANDED
 *               → outbound      the CTA on that page    FunnelEvent: OUTBOUND
 *               → OF link       one per Reddit account  (OF's own attribution)
 *               → subscription  OnlyFans API            Conversion
 */

const CRAWLER_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|preview|headless|python-requests|curl|wget|axios|okhttp|scrapy|lighthouse|pingdom|uptime/i

export interface VisitorSignals {
  ip: string
  userAgent: string
  referrer: string | null
  acceptLanguage: string | null
  countryCode: string | null
}

export function readSignals(headers: Headers): VisitorSignals {
  return {
    ip:
      headers.get('x-forwarded-for')?.split(',')[0].trim() ?? headers.get('x-real-ip') ?? '0.0.0.0',
    userAgent: headers.get('user-agent') ?? '',
    referrer: headers.get('referer'),
    acceptLanguage: headers.get('accept-language'),
    // set by most CDNs; null locally
    countryCode:
      headers.get('cf-ipcountry') ??
      headers.get('x-vercel-ip-country') ??
      headers.get('x-country-code'),
  }
}

export function deviceType(userAgent: string): string {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet'
  if (/mobile|android|iphone/i.test(userAgent)) return 'mobile'
  return 'desktop'
}

/**
 * Bot filtering at the LANDED stage only. Two cheap signals catch most of it:
 * a known crawler user-agent, and a repeat hit from the same IP inside 500ms,
 * which is a preview fetcher rather than a person.
 */
export async function looksLikeBot(signals: VisitorSignals, ipHash: string): Promise<boolean> {
  if (!signals.userAgent || CRAWLER_UA.test(signals.userAgent)) return true

  const recent = await prisma.funnelEvent.findFirst({
    where: { ipHash, type: 'LANDED', ts: { gte: new Date(Date.now() - 500) } },
    select: { id: true },
  })
  return Boolean(recent)
}

export interface Attribution {
  postId: string | null
  type: AttributionType
  /** confidence in the chosen post: 1 when only one candidate was live */
  weight: number
  candidates: number
}

/**
 * Attribute a landing to whichever of that account's posts was live at the time.
 *
 * When several overlap we split proportionally by upvote velocity — implemented
 * as a weighted random pick of one post per landing rather than fractional rows.
 * A landing physically happened once, so it stays one row; across many landings
 * the distribution converges on the true proportional split, and the recorded
 * weight lets a report disclose how confident the attribution was.
 *
 * Velocity is approximated as upvotes per hour since posting rather than read
 * from the metric series: this runs in the visitor's request path, and one
 * extra round trip per landing is not worth a second decimal place.
 */
export async function attributeLanding(
  redditAccountId: string,
  at: Date,
  windowHours = 72,
): Promise<Attribution> {
  const candidates = await prisma.post.findMany({
    where: {
      redditAccountId,
      postedAt: { lte: at, gte: new Date(at.getTime() - windowHours * 3_600_000) },
      OR: [{ removedAt: null }, { removedAt: { gt: at } }],
    },
    orderBy: { postedAt: 'desc' },
    take: 6,
    select: { id: true, postedAt: true, latestUpvotes: true },
  })

  if (candidates.length === 0) return { postId: null, type: 'EXACT', weight: 1, candidates: 0 }
  if (candidates.length === 1)
    return { postId: candidates[0].id, type: 'EXACT', weight: 1, candidates: 1 }

  const scored = candidates.map((p) => {
    const hours = Math.max(0.25, (at.getTime() - p.postedAt.getTime()) / 3_600_000)
    // decay: a post 60 hours old is not still pulling traffic like a fresh one
    const decay = Math.exp(-hours / 18)
    return { id: p.id, velocity: Math.max(0.01, (p.latestUpvotes / hours) * decay) }
  })

  const total = scored.reduce((s, c) => s + c.velocity, 0)
  let roll = Math.random() * total
  let winner = scored[0]
  for (const c of scored) {
    roll -= c.velocity
    if (roll <= 0) {
      winner = c
      break
    }
  }

  return {
    postId: winner.id,
    type: 'INFERRED',
    weight: Number((winner.velocity / total).toFixed(3)),
    candidates: candidates.length,
  }
}

export interface LandingResult {
  sessionHash: string
  eventId: string | null
  isBot: boolean
}

export async function recordLanding(opts: {
  trackedLinkId: string
  redditAccountId: string
  signals: VisitorSignals
  attributionWindowH: number
}): Promise<LandingResult> {
  const now = new Date()
  const ipHash = privacyHash(opts.signals.ip, 'ip')
  const sessionHash = privacyHash(
    `${opts.signals.ip}:${opts.signals.userAgent}:${Math.floor(now.getTime() / 1_800_000)}`,
    'sess',
  )
  const isBot = await looksLikeBot(opts.signals, ipHash)
  const attribution = await attributeLanding(opts.redditAccountId, now, opts.attributionWindowH)

  const event = await prisma.funnelEvent.create({
    data: {
      trackedLinkId: opts.trackedLinkId,
      type: 'LANDED',
      attributedPostId: attribution.postId,
      attributionType: attribution.type,
      attributionWeight: attribution.weight,
      ts: now,
      sessionHash,
      ipHash,
      countryCode: opts.signals.countryCode,
      deviceType: deviceType(opts.signals.userAgent),
      userAgentHash: privacyHash(opts.signals.userAgent, 'ua'),
      isBot,
      referrer: opts.signals.referrer?.slice(0, 300) ?? null,
    },
    select: { id: true },
  })

  return { sessionHash, eventId: event.id, isBot }
}

export async function recordOutbound(opts: {
  trackedLinkId: string
  sessionHash: string
  signals: VisitorSignals
}) {
  // reuse the landing's attribution so the two stages of the same visit agree
  const landing = await prisma.funnelEvent.findFirst({
    where: { trackedLinkId: opts.trackedLinkId, sessionHash: opts.sessionHash, type: 'LANDED' },
    orderBy: { ts: 'desc' },
    select: { attributedPostId: true, attributionType: true, attributionWeight: true, isBot: true },
  })

  await prisma.funnelEvent.create({
    data: {
      trackedLinkId: opts.trackedLinkId,
      type: 'OUTBOUND',
      attributedPostId: landing?.attributedPostId ?? null,
      attributionType: landing?.attributionType ?? 'EXACT',
      attributionWeight: landing?.attributionWeight ?? 1,
      ts: new Date(),
      sessionHash: opts.sessionHash,
      ipHash: privacyHash(opts.signals.ip, 'ip'),
      countryCode: opts.signals.countryCode,
      deviceType: deviceType(opts.signals.userAgent),
      userAgentHash: privacyHash(opts.signals.userAgent, 'ua'),
      isBot: landing?.isBot ?? false,
      referrer: opts.signals.referrer?.slice(0, 300) ?? null,
    },
  })
}

/**
 * A broken bio link on a live account is silent revenue loss, so an unknown
 * slug never errors: it resolves to a working destination, records the miss and
 * raises an alert.
 */
export async function resolveMissingSlug(slug: string) {
  const fallbackCreator = await prisma.creator.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { ofUsername: true, stageName: true },
  })

  const { notifyManagers } = await import('@/lib/jobs/notify')
  await notifyManagers({
    severity: 'CRITICAL',
    title: `Unknown funnel slug hit: /${slug}`,
    body: fallbackCreator
      ? `Sent to ${fallbackCreator.stageName} as a fallback. A live bio link is pointing at a slug we do not have.`
      : 'No fallback creator is configured, so the visitor saw a bare page.',
    href: '/accounts?links=1',
    entityType: 'TrackedLink',
  })

  return fallbackCreator
    ? `https://onlyfans.com/${fallbackCreator.ofUsername}`
    : 'https://onlyfans.com'
}

export function ofDestination(ofTrackingLinkId: string | null, ofUsername: string | null): string {
  const base = ofUsername ? `https://onlyfans.com/${ofUsername}` : 'https://onlyfans.com'
  // OF's own attribution carries the account identity through to the sub, which
  // is what makes ofTrackingLinkId the join key to revenue.
  return ofTrackingLinkId ? `${base}?c=${encodeURIComponent(ofTrackingLinkId)}` : base
}
