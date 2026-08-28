import { prisma } from '@/lib/prisma'
import { tracedByCampaign } from './traced-revenue'

/**
 * The OnlyFans tracking links, with what each one earned in a window.
 *
 * Earnings here are per link, counting every fan who claimed it — the same rule
 * the OnlyFans panel uses, and the reason a fan who claimed two links appears
 * under both. These rows therefore do not sum to the dashboard total, which
 * counts each fan once; they are for ranking links against each other.
 */

export interface OfLinkRow {
  id: string
  code: number
  name: string
  model: string | null
  url: string | null
  trackedInCrm: boolean
  /** what the name classifier thought, kept so a hand change is visible as one */
  classifiedReddit: boolean
  redditAccount: string | null
  clicks: number
  subs: number
  claimersCached: number
  spenders: number
  revenueCents: number
  createdAt: Date | null
}

export async function listOfLinks(start: Date, end: Date): Promise<OfLinkRow[]> {
  const [links, money] = await Promise.all([
    prisma.ofCampaign.findMany({
      where: { isDeleted: false },
      orderBy: [{ ofUsername: 'asc' }, { subs: 'desc' }],
      select: {
        id: true,
        campaignCode: true,
        name: true,
        ofUsername: true,
        clicks: true,
        subs: true,
        claimersCached: true,
        trackedInCrm: true,
        isReddit: true,
        redditOverride: true,
        ofCreatedAt: true,
        redditAccount: { select: { username: true } },
      },
    }),
    tracedByCampaign(start, end),
  ])

  return links.map((l) => {
    const m = money.get(l.id)
    return {
      id: l.id,
      code: l.campaignCode,
      name: l.name,
      model: l.ofUsername,
      url: l.ofUsername ? `https://onlyfans.com/${l.ofUsername}/c${l.campaignCode}` : null,
      trackedInCrm: l.trackedInCrm,
      classifiedReddit: l.redditOverride ?? l.isReddit,
      redditAccount: l.redditAccount?.username ?? null,
      clicks: l.clicks,
      subs: l.subs,
      claimersCached: l.claimersCached,
      spenders: m?.spenders ?? 0,
      revenueCents: m?.cents ?? 0,
      createdAt: l.ofCreatedAt,
    }
  })
}
