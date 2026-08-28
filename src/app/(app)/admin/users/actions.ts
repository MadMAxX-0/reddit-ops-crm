'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/session'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'
import { COMMON_TIMEZONES } from '@/lib/time'

const ROLES = ['POSTER', 'FARMER', 'MANAGER', 'ADMIN'] as const

const baseSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  role: z.enum(ROLES),
  timezone: z
    .string()
    .refine(
      (tz) => COMMON_TIMEZONES.includes(tz) || /^[A-Za-z_]+\/[A-Za-z_+\-]+/.test(tz),
      'Unknown timezone',
    ),
  dailyAccountGoal: z.coerce.number().int().min(0).max(500),
  dailyPostGoal: z.coerce.number().int().min(0).max(500),
  hourlyCostCents: z.coerce.number().int().min(0).max(1_000_000),
  creatorIds: z.array(z.string()).max(100).default([]),
})

export async function createUser(input: z.input<typeof baseSchema> & { password: string }) {
  const ctx = await requireAdmin()
  const parsed = baseSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message }
  if (!input.password || input.password.length < 8) {
    return { ok: false as const, error: 'Password must be at least 8 characters.' }
  }

  const clash = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  })
  if (clash) return { ok: false as const, error: 'That email already has an account.' }

  const { creatorIds, ...data } = parsed.data
  const user = await prisma.user.create({
    data: {
      ...data,
      passwordHash: await bcrypt.hash(input.password, 10),
      creators: creatorIds.length ? { connect: creatorIds.map((id) => ({ id })) } : undefined,
    },
  })

  await writeAudit({
    actorId: ctx.user.id,
    action: 'user.create',
    entityType: 'User',
    entityId: user.id,
    after: { name: user.name, email: user.email, role: user.role },
  })
  revalidatePath('/admin/users')
  return { ok: true as const, userId: user.id }
}

export async function updateUser(userId: string, input: z.input<typeof baseSchema>) {
  const ctx = await requireAdmin()
  const parsed = baseSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message }

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      role: true,
      timezone: true,
      dailyAccountGoal: true,
      dailyPostGoal: true,
      hourlyCostCents: true,
    },
  })
  if (!before) return { ok: false as const, error: 'User not found.' }

  const { creatorIds, ...data } = parsed.data
  const after = await prisma.user.update({
    where: { id: userId },
    data: { ...data, creators: { set: creatorIds.map((id) => ({ id })) } },
    select: {
      name: true,
      email: true,
      role: true,
      timezone: true,
      dailyAccountGoal: true,
      dailyPostGoal: true,
      hourlyCostCents: true,
    },
  })

  // role changes are always logged, separately and by name
  if (before.role !== after.role) {
    await writeAudit({
      actorId: ctx.user.id,
      action: AUDIT_ACTIONS.USER_ROLE,
      entityType: 'User',
      entityId: userId,
      before: { role: before.role },
      after: { role: after.role },
    })
  }
  await writeAudit({
    actorId: ctx.user.id,
    action: 'user.update',
    entityType: 'User',
    entityId: userId,
    before,
    after,
  })

  revalidatePath('/admin/users')
  return { ok: true as const }
}

export async function resetPassword(userId: string, password: string) {
  const ctx = await requireAdmin()
  if (!password || password.length < 8) {
    return { ok: false as const, error: 'Password must be at least 8 characters.' }
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  })
  await writeAudit({
    actorId: ctx.user.id,
    action: 'user.password_reset',
    entityType: 'User',
    entityId: userId,
  })
  return { ok: true as const }
}

/**
 * Deactivation preserves history and hands the accounts on.
 *
 * Assignment spans are closed rather than deleted, so every post that person
 * ever made keeps pointing at them — which is the whole reason the history
 * table exists.
 */
export async function deactivateUser(userId: string, reassignToId?: string) {
  const ctx = await requireAdmin()
  if (userId === ctx.user.id) {
    return { ok: false as const, error: 'You cannot deactivate your own account.' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, status: true },
  })
  if (!user) return { ok: false as const, error: 'User not found.' }

  const at = new Date()
  const openAssignments = await prisma.accountAssignment.findMany({
    where: { posterId: userId, endedAt: null },
    select: { redditAccountId: true, creatorId: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } })
    await tx.accountAssignment.updateMany({
      where: { posterId: userId, endedAt: null },
      data: { endedAt: at },
    })

    if (reassignToId && openAssignments.length) {
      await tx.accountAssignment.createMany({
        data: openAssignments.map((a) => ({
          redditAccountId: a.redditAccountId,
          creatorId: a.creatorId,
          posterId: reassignToId,
          startedAt: at,
        })),
      })
      await tx.redditAccount.updateMany({
        where: { id: { in: openAssignments.map((a) => a.redditAccountId) } },
        data: { assignedPosterId: reassignToId },
      })
    } else {
      await tx.redditAccount.updateMany({
        where: { assignedPosterId: userId },
        data: { assignedPosterId: null },
      })
    }
  })

  await writeAudit({
    actorId: ctx.user.id,
    action: 'user.deactivate',
    entityType: 'User',
    entityId: userId,
    before: { status: user.status },
    after: {
      status: 'INACTIVE',
      accountsHandedOver: openAssignments.length,
      reassignedTo: reassignToId ?? null,
    },
  })

  revalidatePath('/admin/users')
  return { ok: true as const, handedOver: openAssignments.length }
}

export async function reactivateUser(userId: string) {
  const ctx = await requireAdmin()
  await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } })
  await writeAudit({
    actorId: ctx.user.id,
    action: 'user.reactivate',
    entityType: 'User',
    entityId: userId,
  })
  revalidatePath('/admin/users')
  return { ok: true as const }
}
