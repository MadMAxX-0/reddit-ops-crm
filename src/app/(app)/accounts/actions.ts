'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCtx, requireManager } from '@/lib/session'
import { decryptSecret } from '@/lib/crypto'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'

const ids = z.array(z.string().min(1)).min(1).max(500)

/**
 * Revealing a credential is a privileged read: it returns plaintext, it demands
 * the caller re-enter their own password, and it always leaves an audit trail
 * naming who looked and at what.
 *
 * The re-auth is not theatre. A logged-in session left open on a shared machine
 * is the realistic way an account password walks out of this building, and a
 * failed attempt is logged too — a burst of them is itself the signal.
 */
export async function revealCredential(
  accountId: string,
  password: string,
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const ctx = await requireCtx()

  const me = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { passwordHash: true },
  })
  const reauthed = Boolean(me && password && (await bcrypt.compare(password, me.passwordHash)))
  if (!reauthed) {
    await writeAudit({
      actorId: ctx.user.id,
      action: 'credential.reveal_denied',
      entityType: 'RedditAccount',
      entityId: accountId,
      after: { reason: 'reauth failed' },
    })
    return { ok: false, error: 'That is not your password.' }
  }

  const account = await prisma.redditAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      username: true,
      passwordEnc: true,
      assignedPosterId: true,
      createdById: true,
    },
  })
  if (!account) return { ok: false, error: 'Account not found.' }

  // a VA may only reveal credentials for accounts they actually work
  const permitted =
    ctx.isManager ||
    (ctx.user.role === 'POSTER' && account.assignedPosterId === ctx.user.id) ||
    (ctx.user.role === 'FARMER' && account.createdById === ctx.user.id)
  if (!permitted) return { ok: false, error: 'You do not have access to this account.' }

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.CREDENTIAL_REVEAL,
    entityType: 'RedditAccount',
    entityId: account.id,
    after: { username: account.username },
  })

  try {
    return { ok: true, password: decryptSecret(account.passwordEnc) }
  } catch {
    return { ok: false, error: 'Stored credential could not be decrypted with the current key.' }
  }
}

const reassignSchema = z.object({
  accountIds: ids,
  creatorId: z.string().min(1),
  posterId: z.string().min(1),
})

/**
 * Reassignment closes the open AccountAssignment span and opens a new one.
 * It never rewrites history: posts already made keep the creator and poster
 * that held the account at postedAt.
 */
export async function reassignAccounts(input: z.infer<typeof reassignSchema>) {
  const ctx = await requireManager()
  const parsed = reassignSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Invalid reassignment.' }
  const { accountIds, creatorId, posterId } = parsed.data
  const at = new Date()

  const before = await prisma.redditAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, username: true, assignedCreatorId: true, assignedPosterId: true },
  })

  await prisma.$transaction([
    prisma.accountAssignment.updateMany({
      where: { redditAccountId: { in: accountIds }, endedAt: null },
      data: { endedAt: at },
    }),
    prisma.accountAssignment.createMany({
      data: accountIds.map((redditAccountId) => ({
        redditAccountId,
        creatorId,
        posterId,
        startedAt: at,
      })),
    }),
    prisma.redditAccount.updateMany({
      where: { id: { in: accountIds } },
      data: { assignedCreatorId: creatorId, assignedPosterId: posterId },
    }),
  ])

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.ACCOUNT_REASSIGN,
    entityType: 'RedditAccount',
    entityId: accountIds.length === 1 ? accountIds[0] : null,
    before: { accounts: before },
    after: { creatorId, posterId, count: accountIds.length },
  })

  revalidatePath('/accounts')
  return { ok: true as const, count: accountIds.length }
}

export async function retireAccounts(accountIds: string[]) {
  const ctx = await requireManager()
  const parsed = ids.safeParse(accountIds)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }
  const at = new Date()

  await prisma.$transaction([
    prisma.accountAssignment.updateMany({
      where: { redditAccountId: { in: parsed.data }, endedAt: null },
      data: { endedAt: at },
    }),
    prisma.redditAccount.updateMany({
      where: { id: { in: parsed.data } },
      data: {
        status: 'RETIRED',
        pollTier: 'DORMANT',
        assignedPosterId: null,
        assignedCreatorId: null,
      },
    }),
    prisma.trackedLink.updateMany({
      where: { redditAccountId: { in: parsed.data }, status: 'ACTIVE' },
      data: { status: 'RETIRED', retiredAt: at },
    }),
  ])

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.ACCOUNT_RETIRE,
    entityType: 'RedditAccount',
    entityId: parsed.data.length === 1 ? parsed.data[0] : null,
    after: { count: parsed.data.length },
  })

  revalidatePath('/accounts')
  return { ok: true as const, count: parsed.data.length }
}

export async function markSuspended(accountIds: string[]) {
  const ctx = await requireManager()
  const parsed = ids.safeParse(accountIds)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }
  const at = new Date()

  await prisma.$transaction([
    prisma.accountAssignment.updateMany({
      where: { redditAccountId: { in: parsed.data }, endedAt: null },
      data: { endedAt: at },
    }),
    prisma.redditAccount.updateMany({
      where: { id: { in: parsed.data } },
      data: { status: 'SUSPENDED', suspendedAt: at, healthScore: 0, pollTier: 'DORMANT' },
    }),
  ])

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.ACCOUNT_SUSPEND,
    entityType: 'RedditAccount',
    entityId: parsed.data.length === 1 ? parsed.data[0] : null,
    after: { count: parsed.data.length, suspendedAt: at.toISOString() },
  })

  revalidatePath('/accounts')
  return { ok: true as const, count: parsed.data.length }
}
