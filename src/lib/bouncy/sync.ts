import { prisma } from '@/lib/prisma'
import { campaignFromDestination, type BouncyClient } from './client'

/**
 * Pulls bouncy links and their daily click history.
 *
 * Each link is matched to the OnlyFans tracking link it points at, by reading
 * the campaign code out of its destination URL — `onlyfans.com/itsqueenzoe/c62`
 * is campaign 62 on that account. That is an exact identifier, not a name
 * guess, so a link either resolves or is left unmatched and reported.
 */
export async function syncBouncy(
  bouncy: BouncyClient,
  days = 120,
  /**
   * Skip the click history of links that no counted tracking link points at.
   * The hourly job uses this: the dashboard only ever sums links marked
   * `trackedInCrm`, so walking the other ~280 links costs a request each and
   * changes no number on any screen. The link records themselves are still
   * upserted, so one becoming tracked later needs no special case.
   */
  onlyTracked = false,
) {
  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [links, campaigns] = await Promise.all([
    bouncy.links(),
    prisma.ofCampaign.findMany({
      select: { id: true, ofUsername: true, campaignCode: true, trackedInCrm: true },
    }),
  ])
  const byKey = new Map(campaigns.map((c) => [`${c.ofUsername}/${c.campaignCode}`, c.id]))
  const tracked = new Set(campaigns.filter((c) => c.trackedInCrm).map((c) => c.id))

  let matched = 0
  let walked = 0
  let dayRows = 0
  const unmatched: string[] = []
  const errors: string[] = []

  for (const l of links) {
    const target = campaignFromDestination(l.destination)
    const campaignId = target ? (byKey.get(`${target.username}/${target.code}`) ?? null) : null
    if (campaignId) matched++
    else unmatched.push(`${l.slug} -> ${l.destination.slice(0, 60)}`)

    const row = await prisma.bouncyLink.upsert({
      where: { linkId: l.linkId },
      create: {
        linkId: l.linkId,
        slug: l.slug,
        domain: l.domain,
        destination: l.destination,
        isActive: l.isActive,
        campaignId,
      },
      update: {
        slug: l.slug,
        domain: l.domain,
        destination: l.destination,
        isActive: l.isActive,
        campaignId,
      },
    })

    // Bouncy picks its own granularity from the range: ask for four months and
    // it answers in months, and each bucket would be stored as if it were a
    // single day. Chunking to 30 days keeps every response daily.
    // Bouncy picks granularity from the range: months for a long one, days for
    // about a month, hours for a short one. Walking BACKWARDS in 30-day windows
    // keeps every request in the daily band and guarantees the most recent
    // window reaches today — stepping forwards left the final chunk one day
    // wide, which came back hourly and lost today's clicks entirely.
    if (onlyTracked && (!campaignId || !tracked.has(campaignId))) continue

    const daily = new Map<string, { views: number; redditViews: number }>()
    for (let to = new Date(end); to > start;) {
      const from = new Date(Math.max(to.getTime() - 29 * 86_400_000, start.getTime()))
      try {
        const stats = await bouncy.analytics(l.linkId, iso(from), iso(to))
        for (const d of stats.days) {
          // an hourly bucket still names its day in the first ten characters
          const day = d.day.slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
          const acc = daily.get(day) ?? { views: 0, redditViews: 0 }
          acc.views += d.views
          acc.redditViews += d.redditViews
          daily.set(day, acc)
        }
      } catch (err) {
        errors.push(`${l.slug}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
      to = new Date(from.getTime() - 86_400_000)
    }

    walked++
    for (const [day, v] of daily) {
      if (v.views === 0) continue
      await prisma.bouncyClickDay.upsert({
        where: { bouncyId_day: { bouncyId: row.id, day: new Date(`${day}T00:00:00.000Z`) } },
        create: {
          bouncyId: row.id,
          day: new Date(`${day}T00:00:00.000Z`),
          views: v.views,
          redditViews: v.redditViews,
        },
        update: { views: v.views, redditViews: v.redditViews },
      })
      dayRows++
    }
  }

  return { links: links.length, matched, dayRows, unmatched, errors, walked }
}
