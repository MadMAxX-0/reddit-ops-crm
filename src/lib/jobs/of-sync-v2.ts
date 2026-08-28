import { prisma } from '@/lib/prisma'
import { onlyApi, PERIOD_FOR_RANGE, type OfPeriod } from '@/lib/onlyfans/theonlyapi'
import {
  syncCampaigns,
  syncClaimsAndTransactions,
  syncEarningsDays,
  syncFans,
} from '@/lib/onlyfans/campaigns'
import { onlyMonster } from '@/lib/onlymonster/client'
import { syncOnlyMonster } from '@/lib/onlymonster/sync'
import { bouncy } from '@/lib/bouncy/client'
import { syncBouncy } from '@/lib/bouncy/sync'
import { runJob, type JobResult } from './runner'

/**
 * Pulls subscriber counts and earnings from OnlyFans into the database.
 *
 * The dashboard reads the snapshots this writes rather than calling the API on
 * render — a page load should not wait on a third party, and a number that
 * survives that third party being down is worth more than a fresher one that
 * disappears.
 *
 * Matching a model to an OnlyFans account is done once and stored on the
 * creator. Anything unmatched is reported, never guessed: putting Pinky's
 * revenue against Cristine because the names looked similar is worse than
 * showing nothing.
 */

function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function linkOfAccounts() {
  const api = onlyApi()
  if (!api)
    return {
      linked: 0,
      unmatchedApi: [],
      unmatchedCreators: [],
      error: 'ONLYAPI_KEY / ONLYAPI_CRM_ID not set',
    }

  const [accounts, creators] = await Promise.all([
    api.listAccounts(),
    prisma.creator.findMany({
      select: { id: true, stageName: true, ofUsername: true, ofUserId: true },
    }),
  ])

  let linked = 0
  const takenAccounts = new Set(creators.map((c) => c.ofUserId).filter(Boolean) as string[])

  for (const creator of creators) {
    if (creator.ofUserId) continue
    const key = normalise(creator.stageName)

    // a model's name must actually appear in the OF username — "lali" in
    // "laliwhite" is a match, "zoe" in "itsqueenzoe" is a match. Anything
    // looser starts inventing links.
    const hit = accounts.find(
      (a) =>
        a.username &&
        !takenAccounts.has(a.ofUserId) &&
        (normalise(a.username).includes(key) || key.includes(normalise(a.username))),
    )
    if (!hit) continue

    await prisma.creator.update({
      where: { id: creator.id },
      data: { ofUserId: hit.ofUserId, ofUsername: hit.username ?? creator.ofUsername },
    })
    takenAccounts.add(hit.ofUserId)
    linked++
  }

  const after = await prisma.creator.findMany({ select: { stageName: true, ofUserId: true } })
  return {
    linked,
    unmatchedApi: accounts
      .filter((a) => !takenAccounts.has(a.ofUserId))
      .map((a) => a.username ?? a.ofUserId),
    unmatchedCreators: after.filter((c) => !c.ofUserId).map((c) => c.stageName),
    error: null as string | null,
  }
}

export async function runOfSync(opts: { periods?: OfPeriod[] } = {}) {
  return runJob('OF_CONVERSION_SYNC', null, async (ctx): Promise<JobResult> => {
    const api = onlyApi()
    if (!api) {
      return {
        itemsProcessed: 0,
        errorsCount: 0,
        lastError: 'ONLYAPI_KEY / ONLYAPI_CRM_ID not set',
        detail: { skipped: 'not configured' },
      }
    }

    let items = 0
    let errors = 0
    let lastError: string | null = null

    // --- subscriber counts, one row per linked creator ---------------------
    const creators = await prisma.creator.findMany({
      where: { ofUserId: { not: null } },
      select: { id: true, stageName: true, ofUserId: true },
    })

    // Every account in the panel, not only our models: the total subscriber
    // count is the denominator the Reddit share is measured against, and a
    // denominator built only from tracked links credits Reddit with subscribers
    // that never came through any link.
    const panel = await api.listAccounts().catch(() => [])
    const creatorByOfUser = new Map(creators.map((c) => [c.ofUserId!, c.id]))
    const subjects = [
      ...creators.map((c) => ({
        ofUserId: c.ofUserId!,
        label: c.stageName,
        creatorId: c.id as string | undefined,
      })),
      ...panel
        .filter((a) => !creatorByOfUser.has(a.ofUserId))
        .map((a) => ({
          ofUserId: a.ofUserId,
          label: a.username ?? a.ofUserId,
          creatorId: undefined as string | undefined,
        })),
    ]

    for (const c of subjects) {
      try {
        const cache = await api.subscriberCache(c.ofUserId)
        if (!cache) continue
        await prisma.ofSubscriberSnapshot.create({
          data: {
            creatorId: c.creatorId,
            ofUserId: c.ofUserId,
            activeSubs: cache.activeSubs,
            expiredSubs: cache.expiredSubs,
            totalSubs: cache.totalSubs,
            spenders: cache.spenders,
            totalSpentCents: cache.totalSpentCents,
          },
        })
        // keep the existing follower series in step so one curve tells the story
        if (c.creatorId) {
          await prisma.followerSnapshot.create({
            data: { creatorId: c.creatorId, followerCount: cache.activeSubs, source: 'theonlyapi' },
          })
        }
        items++
      } catch (err) {
        errors++
        lastError = `${c.label}: ${err instanceof Error ? err.message : String(err)}`
      }
      ctx.progress(items, errors)
    }

    // --- earnings, one row per period --------------------------------------
    const periods = opts.periods ?? (Object.values(PERIOD_FOR_RANGE) as OfPeriod[])
    for (const period of periods) {
      try {
        const e = await api.earnings(period)
        await prisma.ofEarningsSnapshot.create({
          data: {
            period,
            totalCents: e.totalCents,
            prevTotalCents: e.prevTotalCents,
            messagesCents: e.byCategoryCents.messages,
            subscriptionsCents: e.byCategoryCents.subscriptions,
            tipsCents: e.byCategoryCents.tips,
            postsCents: e.byCategoryCents.posts,
            streamsCents: e.byCategoryCents.streams,
            referralsCents: e.byCategoryCents.referrals,
            transactions: e.transactions,
            accountsCount: e.accountsCount,
            accountsNeverSynced: e.accountsNeverSynced,
            chartDays: e.chartDays,
            chartCents: e.chartCents,
          },
        })
        items++
      } catch (err) {
        errors++
        lastError = `earnings/${period}: ${err instanceof Error ? err.message : String(err)}`
      }
      ctx.progress(items, errors)
    }

    // --- tracking links, and earnings per day per account -------------------
    // These two are what make "revenue from Reddit" answerable: the links say
    // which traffic is Reddit's, the daily earnings say what was earned in any
    // window the dashboard asks for.
    let campaigns: Awaited<ReturnType<typeof syncCampaigns>> | null = null
    let earningsDays: Awaited<ReturnType<typeof syncEarningsDays>> | null = null
    try {
      campaigns = await syncCampaigns(api)
      items += campaigns.links
      errors += campaigns.errors.length
      if (campaigns.errors.length) lastError = `campaigns: ${campaigns.errors[0]}`
    } catch (err) {
      errors++
      lastError = `campaigns: ${err instanceof Error ? err.message : String(err)}`
    }
    ctx.progress(items, errors)

    try {
      earningsDays = await syncEarningsDays(api)
      items += earningsDays.rows
      errors += earningsDays.errors.length
      if (earningsDays.errors.length) lastError = `earnings/day: ${earningsDays.errors[0]}`
    } catch (err) {
      errors++
      lastError = `earnings/day: ${err instanceof Error ? err.message : String(err)}`
    }
    ctx.progress(items, errors)

    // --- who came through which link, and every payment with its fan --------
    // This pair is what makes revenue attribution a lookup instead of a guess.
    let fans: Awaited<ReturnType<typeof syncClaimsAndTransactions>> | null = null
    try {
      fans = await syncClaimsAndTransactions(api)
      items += fans.claims + fans.transactions
      errors += fans.errors.length
      if (fans.errors.length) lastError = `claims: ${fans.errors[0]}`
    } catch (err) {
      errors++
      lastError = `claims: ${err instanceof Error ? err.message : String(err)}`
    }
    ctx.progress(items, errors)

    // --- subscriber dates, at most once every twelve hours ------------------
    // A hundred and thirty thousand rows is not an hourly job, and a fan's
    // subscribe date does not change once it exists — only new fans need it.
    const freshest = await prisma.ofFan.aggregate({ _max: { syncedAt: true } })
    const stale =
      !freshest._max.syncedAt || freshest._max.syncedAt < new Date(Date.now() - 12 * 3_600_000)
    let fanRows = 0
    if (stale) {
      try {
        const r = await syncFans(api)
        fanRows = r.rows
        items += r.rows
        errors += r.errors.length
        if (r.errors.length) lastError = `fans: ${r.errors[0]}`
      } catch (err) {
        errors++
        lastError = `fans: ${err instanceof Error ? err.message : String(err)}`
      }
      ctx.progress(items, errors)
    }

    // --- OnlyMonster's arrival log, at most once every six hours -----------
    // It is the authority on when a subscriber arrived, because it holds fans
    // OnlyFans has since deleted. Paging is all-or-nothing, so this is not an
    // hourly job.
    const om = onlyMonster()
    let omRows = 0
    if (om) {
      const freshestOm = await prisma.omLinkFan.aggregate({ _max: { syncedAt: true } })
      const omStale =
        !freshestOm._max.syncedAt || freshestOm._max.syncedAt < new Date(Date.now() - 6 * 3_600_000)
      if (omStale) {
        try {
          const r = await syncOnlyMonster(om)
          omRows = r.rows
          items += r.rows
          errors += r.errors.length
          if (r.errors.length) lastError = `onlymonster: ${r.errors[0]}`
        } catch (err) {
          errors++
          lastError = `onlymonster: ${err instanceof Error ? err.message : String(err)}`
        }
        ctx.progress(items, errors)
      }
    }

    // --- bouncy's click history ---------------------------------------------
    // The only per-period click figure in the product, and until now it only
    // ever moved when somebody ran `npm run bouncy:sync` by hand — so the
    // dashboard's clicks stopped dead on whatever day that last happened.
    // Ten days rather than the full 120: it covers every window the dashboard
    // offers and re-reads the recent past, which bouncy revises for a day or
    // two after the fact.
    const bcy = bouncy()
    let clickDays = 0
    if (bcy) {
      try {
        const r = await syncBouncy(bcy, 10, true)
        clickDays = r.dayRows
        items += r.dayRows
        errors += r.errors.length
        if (r.errors.length) lastError = `bouncy: ${r.errors[0]}`
      } catch (err) {
        errors++
        lastError = `bouncy: ${err instanceof Error ? err.message : String(err)}`
      }
      ctx.progress(items, errors)
    }

    return {
      itemsProcessed: items,
      errorsCount: errors,
      lastError,
      detail: {
        clickDays,
        creators: creators.length,
        periods: periods.length,
        provider: 'theonlyapi',
        links: campaigns ? campaigns.links : 0,
        redditLinks: campaigns ? campaigns.reddit : 0,
        linksTiedToAccount: campaigns ? campaigns.matched : 0,
        earningsDays: earningsDays ? earningsDays.rows : 0,
        fanClaims: fans ? fans.claims : 0,
        transactions: fans ? fans.transactions : 0,
        fanRows,
        onlyMonsterRows: omRows,
      },
    }
  })
}
