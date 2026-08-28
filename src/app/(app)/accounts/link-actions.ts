'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'

/**
 * Which OnlyFans tracking links the CRM counts.
 *
 * Every change is audited: this switch decides what the revenue figure means,
 * so "why did last month move" has to be answerable.
 */
export async function setLinkTracked(ids: string[], tracked: boolean) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }

  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(ids)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }

  const before = await prisma.ofCampaign.findMany({
    where: { id: { in: parsed.data } },
    select: { id: true, name: true, ofUsername: true, trackedInCrm: true },
  })
  const changed = before.filter((l) => l.trackedInCrm !== tracked)
  if (!changed.length) return { ok: true as const, count: 0 }

  await prisma.ofCampaign.updateMany({
    where: { id: { in: changed.map((l) => l.id) } },
    data: { trackedInCrm: tracked },
  })

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.LINK_TRACKING,
    entityType: 'OfCampaign',
    entityId: changed.length === 1 ? changed[0].id : null,
    before: { tracked: !tracked, links: changed.map((l) => `${l.ofUsername}/${l.name}`) },
    after: { tracked },
  })

  revalidatePath('/accounts')
  revalidatePath('/dashboard')
  return { ok: true as const, count: changed.length }
}
