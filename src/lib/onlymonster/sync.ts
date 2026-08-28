import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { OnlyMonsterClient } from './client'

/**
 * Pulls OnlyMonster's record of who arrived through which tracking link.
 *
 * Only accounts the CRM already knows about are pulled, so this cannot quietly
 * widen what the dashboard counts.
 */
export async function syncOnlyMonster(
  om: OnlyMonsterClient,
  onProgress?: (account: string, rows: number) => void,
) {
  const [accounts, known] = await Promise.all([
    om.accounts(),
    prisma.ofCampaign.groupBy({ by: ['ofUserId'] }),
  ])
  const ours = new Set(known.map((k) => k.ofUserId))

  let rows = 0
  const errors: string[] = []
  const skipped: string[] = []

  for (const account of accounts) {
    if (!ours.has(account.ofUserId)) {
      skipped.push(account.username ?? account.ofUserId)
      continue
    }
    let fans
    try {
      fans = await om.trackingLinkUsers(account.ofUserId, (n) =>
        onProgress?.(account.username ?? account.ofUserId, n),
      )
    } catch (err) {
      errors.push(
        `${account.username ?? account.ofUserId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    // one fan can appear twice on a link across collections; the unique index
    // takes the last write, so de-duplicate before the batch rather than
    // letting a single batch conflict with itself
    const unique = new Map<string, (typeof fans)[number]>()
    for (const f of fans) unique.set(`${f.linkId}:${f.fanId}`, f)

    const list = [...unique.values()]
    for (let i = 0; i < list.length; i += 1000) {
      const batch = list.slice(i, i + 1000)
      const values = batch.map(
        (f) =>
          Prisma.sql`(${randomUUID()}, ${account.ofUserId}, ${f.linkId}, ${f.fanId}, ${f.fanUsername},
                      ${f.subscribedAt ? new Date(f.subscribedAt) : null},
                      ${f.collectedAt ? new Date(f.collectedAt) : null}, NOW())`,
      )
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "OmLinkFan" (id, "ofUserId", "linkId", "fanId", "fanUsername", "subscribedAt", "collectedAt", "syncedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("linkId", "fanId") DO UPDATE SET
            "fanUsername" = EXCLUDED."fanUsername",
            "subscribedAt" = EXCLUDED."subscribedAt",
            "collectedAt" = EXCLUDED."collectedAt",
            "syncedAt" = NOW()
        `,
      )
      rows += batch.length
    }
  }

  return { accounts: accounts.length, rows, skipped, errors }
}
