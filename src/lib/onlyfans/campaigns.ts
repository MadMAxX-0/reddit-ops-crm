import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { TheOnlyApiClient } from './theonlyapi'

/**
 * OnlyFans tracking links are the only place OnlyFans says where a subscriber
 * came from, so they are what "revenue from Reddit" is built on.
 *
 * Two jobs live here: deciding whether a link is a Reddit link, and pulling the
 * links (and per-day earnings) into the database.
 */

/** A link name only counts as Reddit if it says so, or if it names one of our accounts. */
const REDDIT_WORD = /(^|[^a-z])reddit([^a-z]|$)/i

export interface KnownAccount {
  id: string
  username: string
}

export function classifyCampaign(
  name: string,
  accounts: KnownAccount[],
): { isReddit: boolean; redditAccountId: string | null } {
  const hay = name.toLowerCase()

  // Prefer the longest username that appears in the name: "u/SillySinx" and
  // "Reddit-mynameiscutie33" both name an account, in different house styles.
  // Short usernames are excluded because a four-letter handle turns up inside
  // unrelated words and a wrong account is worse than no account.
  let hit: KnownAccount | null = null
  for (const a of accounts) {
    if (a.username.length < 6) continue
    if (!hay.includes(a.username.toLowerCase())) continue
    if (!hit || a.username.length > hit.username.length) hit = a
  }

  const explicit = REDDIT_WORD.test(name) || /(^|[^a-z0-9])u\/[a-z0-9_-]{3,}/i.test(name)
  return {
    isReddit: explicit || hit != null,
    redditAccountId: hit?.id ?? null,
  }
}

/**
 * Pulls every tracking link on every OnlyFans account in the panel, and takes a
 * reading of its lifetime counters.
 *
 * Links are pulled for accounts that are not linked to a model too: the panel's
 * earnings cover all of them, so the Reddit share has to be measured over the
 * same population or the ratio is against the wrong denominator.
 */
export async function syncCampaigns(api: TheOnlyApiClient) {
  const [accounts, creators, redditAccounts] = await Promise.all([
    api.listAccounts(),
    prisma.creator.findMany({
      where: { ofUserId: { not: null } },
      select: { id: true, ofUserId: true },
    }),
    prisma.redditAccount.findMany({ select: { id: true, username: true } }),
  ])

  const creatorByOfUser = new Map(creators.map((c) => [c.ofUserId!, c.id]))
  let links = 0
  let reddit = 0
  let matched = 0
  const errors: string[] = []

  for (const account of accounts) {
    let list
    try {
      list = await api.campaigns(account.ofUserId)
    } catch (err) {
      errors.push(
        `${account.username ?? account.ofUserId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    for (const c of list) {
      const { isReddit, redditAccountId } = classifyCampaign(c.name, redditAccounts)
      const row = await prisma.ofCampaign.upsert({
        where: {
          ofUserId_campaignCode: {
            ofUserId: account.ofUserId,
            campaignCode: c.campaignCode,
          },
        },
        create: {
          ofUserId: account.ofUserId,
          ofUsername: account.username,
          creatorId: creatorByOfUser.get(account.ofUserId) ?? null,
          campaignCode: c.campaignCode,
          ofCampaignId: c.ofCampaignId || null,
          name: c.name,
          isReddit,
          redditAccountId,
          clicks: c.clicks,
          subs: c.subs,
          ofCreatedAt: c.createdAt ? new Date(c.createdAt) : null,
          isDeleted: c.isDeleted,
        },
        update: {
          ofUsername: account.username,
          creatorId: creatorByOfUser.get(account.ofUserId) ?? null,
          name: c.name,
          // the name reader's opinion; `redditOverride` is deliberately not
          // written here, so a hand-set source survives every later sync
          isReddit,
          redditAccountId,
          clicks: c.clicks,
          subs: c.subs,
          isDeleted: c.isDeleted,
        },
      })
      await prisma.ofCampaignSnapshot.create({
        data: { campaignId: row.id, clicks: c.clicks, subs: c.subs },
      })
      links++
      if (row.redditOverride ?? isReddit) reddit++
      if (redditAccountId) matched++
    }
  }

  return { accounts: accounts.length, links, reddit, matched, errors }
}

/**
 * Net earnings per day per OnlyFans account, so any date range can be summed.
 *
 * The default reaches back further than the longest window on the dashboard,
 * because "30 days" is shown against the 30 days before it — pull only 45 and
 * the comparison silently measures a full month against half of one.
 */
export async function syncEarningsDays(api: TheOnlyApiClient, days = 120) {
  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [accounts, creators] = await Promise.all([
    api.listAccounts(),
    prisma.creator.findMany({
      where: { ofUserId: { not: null } },
      select: { id: true, ofUserId: true },
    }),
  ])
  const creatorByOfUser = new Map(creators.map((c) => [c.ofUserId!, c.id]))

  let rows = 0
  const errors: string[] = []
  for (const account of accounts) {
    try {
      const series = await api.earningsByDay(account.ofUserId, iso(start), iso(end))
      for (const d of series) {
        const day = new Date(`${d.day}T00:00:00.000Z`)
        await prisma.ofEarningsDay.upsert({
          where: { ofUserId_day: { ofUserId: account.ofUserId, day } },
          create: {
            ofUserId: account.ofUserId,
            creatorId: creatorByOfUser.get(account.ofUserId) ?? null,
            day,
            netCents: d.netCents,
            transactions: d.transactions,
          },
          update: {
            creatorId: creatorByOfUser.get(account.ofUserId) ?? null,
            netCents: d.netCents,
            transactions: d.transactions,
          },
        })
        rows++
      }
    } catch (err) {
      errors.push(
        `${account.username ?? account.ofUserId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { accounts: accounts.length, rows, errors }
}

/**
 * Pulls the fan-level data that turns attribution from an estimate into a
 * lookup: who came through which link, and every payment with the fan who made
 * it. Both come from the platform cache, so this costs no OnlyFans requests.
 */
export async function syncClaimsAndTransactions(api: TheOnlyApiClient, days = 120) {
  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const campaigns = await prisma.ofCampaign.findMany({
    where: { isDeleted: false },
    select: { id: true, ofUserId: true, ofCampaignId: true, name: true },
  })
  const accounts = [...new Set(campaigns.map((c) => c.ofUserId))]

  let claims = 0
  let transactions = 0
  const errors: string[] = []

  for (const c of campaigns) {
    if (!c.ofCampaignId) continue
    try {
      const claimers = await api.campaignClaimers(c.ofUserId, c.ofCampaignId)
      for (const claimer of claimers) {
        await prisma.ofFanClaim.upsert({
          where: {
            ofUserId_fanId_campaignId: {
              ofUserId: c.ofUserId,
              fanId: claimer.fanId,
              campaignId: c.id,
            },
          },
          create: {
            ofUserId: c.ofUserId,
            fanId: claimer.fanId,
            campaignId: c.id,
            fanUsername: claimer.fanUsername,
            claimedAt: claimer.claimedAt ? new Date(claimer.claimedAt) : null,
            subscribedAt: claimer.subscribedAt ? new Date(claimer.subscribedAt) : null,
          },
          update: {
            fanUsername: claimer.fanUsername,
            claimedAt: claimer.claimedAt ? new Date(claimer.claimedAt) : null,
            ...(claimer.subscribedAt ? { subscribedAt: new Date(claimer.subscribedAt) } : {}),
          },
        })
        claims++
      }
      await prisma.ofCampaign.update({
        where: { id: c.id },
        data: { claimersCached: claimers.length },
      })
    } catch (err) {
      errors.push(`claimers ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  for (const ofUserId of accounts) {
    try {
      const rows = await api.transactions(ofUserId, iso(start), iso(end))
      for (const t of rows) {
        await prisma.ofTransaction.upsert({
          where: { ofUserId_txId: { ofUserId, txId: t.txId } },
          create: {
            ofUserId,
            txId: t.txId,
            fanId: t.fanId,
            ts: new Date(t.ts),
            grossCents: t.grossCents,
            netCents: t.netCents,
            kind: t.kind,
          },
          update: { fanId: t.fanId, netCents: t.netCents, grossCents: t.grossCents, kind: t.kind },
        })
        transactions++
      }
    } catch (err) {
      errors.push(`transactions ${ofUserId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { campaigns: campaigns.length, claims, transactions, errors }
}

/**
 * Pulls every subscriber with the date they actually subscribed.
 *
 * Needed because a claim row's date is when the cache first saw the fan, not
 * when the fan arrived — entire links are stamped with one backfill day. Only
 * this date can honestly separate "money from fans this period brought in" from
 * "money from fans we already had".
 *
 * Rows go in through a batched upsert rather than one call each: there are more
 * than a hundred thousand of them and Prisma's per-row upsert would take the
 * better part of an hour.
 */
export async function syncFans(
  api: TheOnlyApiClient,
  onProgress?: (account: string, n: number, total: number | null) => void,
) {
  const accounts = await api.listAccounts()
  let rows = 0
  const errors: string[] = []

  for (const account of accounts) {
    let fans
    try {
      fans = await api.subscribersCached(account.ofUserId, (n, total) =>
        onProgress?.(account.username ?? account.ofUserId, n, total),
      )
    } catch (err) {
      errors.push(
        `${account.username ?? account.ofUserId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    for (let i = 0; i < fans.length; i += 1000) {
      const batch = fans.slice(i, i + 1000)
      const values = batch.map(
        (f) =>
          Prisma.sql`(${randomUUID()}, ${account.ofUserId}, ${f.fanId}, ${
            f.subscribedAt ? new Date(f.subscribedAt) : null
          }, ${f.expiredAt ? new Date(f.expiredAt) : null}, ${f.totalSpentCents}, NOW())`,
      )
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "OfFan" (id, "ofUserId", "fanId", "subscribedAt", "expiredAt", "totalSpentCents", "syncedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("ofUserId", "fanId") DO UPDATE SET
            "subscribedAt" = EXCLUDED."subscribedAt",
            "expiredAt" = EXCLUDED."expiredAt",
            "totalSpentCents" = EXCLUDED."totalSpentCents",
            "syncedAt" = NOW()
        `,
      )
      rows += batch.length
    }
  }

  return { accounts: accounts.length, rows, errors }
}
