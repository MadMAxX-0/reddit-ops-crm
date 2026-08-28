'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'

const STAGES = ['CREATING', 'FARMING', 'ACTIVE'] as const
const FLAGS = ['NONE', 'BANNED', 'SHADOWBANNED', 'ON_HOLD'] as const

export async function setStage(ids: string[], stage: (typeof STAGES)[number]) {
  await requireCtx()
  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(ids)
  if (!parsed.success || !STAGES.includes(stage))
    return { ok: false as const, error: 'Nothing to move.' }

  await prisma.redditAccount.updateMany({
    where: { id: { in: parsed.data } },
    data: {
      pipelineStage: stage,
      // an account going Active is in rotation; one sent back to farming is
      // not. Keeping status in step means the rest of the product does not
      // disagree with this screen.
      ...(stage === 'ACTIVE' ? { status: 'ACTIVE' as const } : {}),
      ...(stage === 'FARMING' ? { status: 'WARMING' as const } : {}),
    },
  })
  revalidatePath('/pipeline')
  return { ok: true as const, count: parsed.data.length }
}

export async function setFlag(ids: string[], flag: (typeof FLAGS)[number]) {
  const ctx = await requireCtx()
  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(ids)
  if (!parsed.success || !FLAGS.includes(flag))
    return { ok: false as const, error: 'Nothing to flag.' }

  const now = new Date()
  await prisma.redditAccount.updateMany({
    where: { id: { in: parsed.data } },
    data: {
      flag,
      ...(flag === 'BANNED'
        ? { status: 'SUSPENDED' as const, suspendedAt: now, healthScore: 0 }
        : {}),
      ...(flag === 'SHADOWBANNED' ? { status: 'SHADOWBANNED' as const, shadowbanned: true } : {}),
      ...(flag === 'NONE' ? { suspendedAt: null, shadowbanned: false } : {}),
    },
  })

  if (flag === 'BANNED') {
    // a banned account stops being anyone's to post from
    await prisma.accountAssignment.updateMany({
      where: { redditAccountId: { in: parsed.data }, endedAt: null },
      data: { endedAt: now },
    })
    await writeAudit({
      actorId: ctx.user.id,
      action: AUDIT_ACTIONS.ACCOUNT_SUSPEND,
      entityType: 'RedditAccount',
      entityId: parsed.data.length === 1 ? parsed.data[0] : null,
      after: { flag, count: parsed.data.length },
    })
  }

  revalidatePath('/pipeline')
  return { ok: true as const }
}

export async function setDevice(ids: string[], device: string) {
  await requireCtx()
  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(ids)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }
  await prisma.redditAccount.updateMany({
    where: { id: { in: parsed.data } },
    data: { device: device.trim() || null },
  })
  revalidatePath('/pipeline')
  return { ok: true as const }
}

export async function removeAccounts(ids: string[]) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Only managers remove accounts.' }
  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(ids)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }

  // Retire rather than delete: a deleted account takes its post history with it,
  // and that history is what every past number rests on.
  await prisma.redditAccount.updateMany({
    where: { id: { in: parsed.data } },
    data: { status: 'RETIRED', assignedPosterId: null, pollTier: 'DORMANT' },
  })
  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.ACCOUNT_RETIRE,
    entityType: 'RedditAccount',
    after: { count: parsed.data.length, via: 'pipeline' },
  })
  revalidatePath('/pipeline')
  return { ok: true as const, count: parsed.data.length }
}

const addSchema = z.object({
  usernames: z.string().min(1).max(20_000),
  device: z.string().optional().or(z.literal('')),
  stage: z.enum(STAGES),
})

export async function addAccounts(input: z.input<typeof addSchema>) {
  await requireCtx()
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message }

  const names = parsed.data.usernames
    .split('\n')
    .map((n) => n.trim().replace(/^u\//, ''))
    .filter(Boolean)
  if (!names.length) return { ok: false as const, error: 'No usernames.' }

  const { encryptSecret } = await import('@/lib/crypto')
  let created = 0
  const skipped: string[] = []

  for (const username of names) {
    const clash = await prisma.redditAccount.findUnique({
      where: { username },
      select: { id: true },
    })
    if (clash) {
      skipped.push(username)
      continue
    }
    await prisma.redditAccount.create({
      data: {
        username,
        passwordEnc: encryptSecret('not-set'),
        emailAddress: '',
        device: parsed.data.device || null,
        pipelineStage: parsed.data.stage,
        status: 'WARMING',
        pollTier: 'DORMANT',
        healthScore: 0,
      },
    })
    created++
  }

  revalidatePath('/pipeline')
  return { ok: true as const, created, skipped }
}
