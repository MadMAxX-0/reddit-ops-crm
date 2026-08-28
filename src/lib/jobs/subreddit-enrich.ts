import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { readRules } from './subreddit-rules-read'

/**
 * Fills in what each discovered subreddit demands of a poster.
 *
 * Discovery answers "who posts where". This answers "could we post there" —
 * karma floor, verification, whether original content is required, whether the
 * sub bans the promotion the whole operation exists to do. Two requests per
 * subreddit, so it runs over the ones that have never been read first and
 * re-reads the rest slowly; mods change rules, but not hourly.
 */
export async function enrichSubreddits(opts: { names?: string[]; limit?: number } = {}) {
  const provider = redditProvider()
  const limit = opts.limit ?? 25
  const stale = new Date(Date.now() - 14 * 86_400_000)

  const where: Prisma.DiscoveredSubredditWhereInput = opts.names?.length
    ? { name: { in: opts.names } }
    : { dismissed: false, OR: [{ rulesCheckedAt: null }, { rulesCheckedAt: { lt: stale } }] }

  const subs = await prisma.discoveredSubreddit.findMany({
    where,
    // never-read first, then oldest reading
    orderBy: [{ rulesCheckedAt: { sort: 'asc', nulls: 'first' } }, { targets: 'desc' }],
    take: limit,
    select: { id: true, name: true },
  })

  let read = 0
  let missing = 0
  let errors = 0
  const recovered: string[] = []
  const failures: string[] = []

  for (const sub of subs) {
    try {
      const [info, rules] = await Promise.all([
        provider.getSubreddit(sub.name),
        provider.getSubredditRules ? provider.getSubredditRules(sub.name) : Promise.resolve([]),
      ])

      const parsed = readRules(
        rules.map((r) => ({
          short_name: r.shortName,
          description: r.description,
          violation_reason: r.violationReason ?? undefined,
        })),
      )

      // Reddit refused to serve it: banned, private, or it never existed. Record
      // exactly that and touch nothing else. The old code wrote the absent
      // snapshot through — subscribers null, over18 false, ruleCount 0, every
      // requirement null — which files a dead subreddit as an open, SFW one
      // with no rules, and then sets `rulesCheckedAt` so nothing re-reads it
      // for a fortnight. Seven subreddits in the first imported niche looked
      // like the safest targets on the list for that reason alone.
      if (!info.exists) {
        // One "subreddit not found" is not proof. On 2026-08-25 a single pass
        // condemned 18 subreddits; a re-read the same hour brought four of them
        // back, one with 174,535 subscribers. The host answers not-found
        // transiently, the same way its listings return empty for accounts that
        // provably have posts. Condemning a subreddit removes it from every
        // list, so it takes three refusals in a row, spaced out.
        let confirmed = true
        for (let attempt = 0; attempt < 2 && confirmed; attempt++) {
          await new Promise((r) => setTimeout(r, 1_500))
          const retry = await provider.getSubreddit(sub.name)
          if (retry.exists) {
            confirmed = false
            recovered.push(sub.name)
          }
        }
        if (confirmed) {
          await prisma.discoveredSubreddit.update({
            where: { id: sub.id },
            data: { unavailable: true, rulesCheckedAt: new Date() },
          })
          missing++
          continue
        }
        // it answered on retry — fall through and read it properly next pass
        await prisma.discoveredSubreddit.update({
          where: { id: sub.id },
          data: { unavailable: false, rulesCheckedAt: null },
        })
        continue
      }

      await prisma.discoveredSubreddit.update({
        where: { id: sub.id },
        data: {
          unavailable: false,
          subscribers: info.subscribers,
          over18: info.isNsfw,
          description: info.rulesSummary,
          submissionType: info.submissionType,
          allowsImages: info.allowsImages,
          allowsVideos: info.allowsVideos,
          allowsGalleries: info.allowsGalleries,
          restrictedPosting: info.restrictedPosting,
          subredditType: info.subredditType,
          quarantined: info.quarantined,
          subCreatedAt: info.createdAt,
          submitText: info.submitText,
          // the sub's own flag is authority on verification; the rule text only
          // fills in when it says nothing
          requiresVerification: info.verificationRequired ? true : parsed.requiresVerification,
          minKarma: parsed.minKarma,
          minAccountAgeDays: parsed.minAccountAgeDays,
          originalContentOnly: parsed.originalContentOnly,
          bansAskingForUpvotes: parsed.bansAskingForUpvotes,
          rulesJson: rules as unknown as object,
          ruleCount: rules.length,
          rulesCheckedAt: new Date(),
        },
      })
      read++
    } catch (err) {
      errors++
      failures.push(`${sub.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { considered: subs.length, read, missing, recovered, errors, failures }
}
