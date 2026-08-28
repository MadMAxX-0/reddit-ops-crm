import { prisma } from '@/lib/prisma'
import { onlyFansProvider } from '@/lib/onlyfans'
import { getWorkspace } from '@/lib/workspace'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'

/**
 * Pulls subscriptions and earnings from OnlyFans and writes Conversion rows
 * keyed by ofTrackingLinkId — the join key that carries Reddit-account identity
 * through OF's own attribution.
 *
 * externalId is unique, so the sync is idempotent and a replayed window cannot
 * double-count revenue.
 */
export async function runConversionSync(opts: { sinceHours?: number } = {}) {
  return runJob('OF_CONVERSION_SYNC', null, async (ctx): Promise<JobResult> => {
    const config = await getJobConfig('OF_CONVERSION_SYNC')
    if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

    const workspace = await getWorkspace()
    const provider = onlyFansProvider()
    const windowH = opts.sinceHours ?? workspace.attributionWindowH
    const since = new Date(Date.now() - windowH * 3_600_000)

    const [conversions, followers, links, creators] = await Promise.all([
      provider.listConversions(since),
      provider.listFollowerCounts(),
      prisma.trackedLink.findMany({
        where: { ofTrackingLinkId: { not: null } },
        select: {
          id: true,
          ofTrackingLinkId: true,
          redditAccount: { select: { assignedCreatorId: true } },
        },
      }),
      prisma.creator.findMany({ select: { id: true, ofUsername: true } }),
    ])

    const linkByOf = new Map(links.map((l) => [l.ofTrackingLinkId!, l]))
    const creatorByOf = new Map(creators.map((c) => [c.ofUsername, c.id]))

    let written = 0
    let unmatched = 0
    let errors = 0
    let lastError: string | null = null

    for (const conv of conversions) {
      try {
        const link = conv.ofTrackingLinkId ? linkByOf.get(conv.ofTrackingLinkId) : undefined
        const creatorId = link?.redditAccount.assignedCreatorId ?? creatorByOf.get(conv.ofUsername)
        if (!creatorId) {
          // revenue we cannot place against a creator is still revenue; count it
          // as unmatched rather than dropping it silently
          unmatched += 1
          continue
        }
        if (!link) unmatched += 1

        await prisma.conversion.upsert({
          where: { externalId: conv.externalId },
          create: {
            externalId: conv.externalId,
            ofTrackingLinkId: conv.ofTrackingLinkId ?? 'unattributed',
            trackedLinkId: link?.id ?? null,
            creatorId,
            type: conv.type,
            amountCents: conv.amountCents,
            occurredAt: conv.occurredAt,
          },
          update: { amountCents: conv.amountCents, syncedAt: new Date() },
        })
        written += 1
      } catch (err) {
        errors += 1
        lastError = err instanceof Error ? err.message : String(err)
      }
      ctx.progress(written, errors)
    }

    for (const f of followers) {
      const creatorId = creatorByOf.get(f.ofUsername)
      if (!creatorId) continue
      await prisma.followerSnapshot.create({
        data: { creatorId, ts: f.at, followerCount: f.followerCount, source: 'OF_API' },
      })
    }

    return {
      itemsProcessed: written,
      errorsCount: errors,
      lastError,
      detail: { unmatched, windowH, provider: provider.name },
    }
  })
}
