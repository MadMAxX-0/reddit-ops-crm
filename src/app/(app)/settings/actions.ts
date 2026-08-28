'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCtx, requireManager } from '@/lib/session'
import { writeAudit } from '@/lib/audit'

const tzShape = /^[A-Za-z_]+\/[A-Za-z_+\-]+(\/[A-Za-z_+\-]+)?$|^UTC$/

export async function updateMyTimezone(timezone: string) {
  const ctx = await requireCtx()
  if (!tzShape.test(timezone)) return { ok: false as const, error: 'Not a valid IANA timezone.' }
  await prisma.user.update({ where: { id: ctx.user.id }, data: { timezone } })
  revalidatePath('/settings')
  return { ok: true as const }
}

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dayBoundaryTimezone: z.string().regex(tzShape, 'Not a valid IANA timezone'),
  funnelBaseUrl: z.string().url(),
  attributionWindowH: z.coerce.number().int().min(1).max(720),
})

/**
 * Changing the day-boundary timezone re-buckets every daily aggregate in the
 * product from the next read onward. It does not rewrite AccountCreationAttempt
 * batchDate values already on disk, so historic daily counters keep the day
 * they were filed under. Say so rather than pretending it is retroactive.
 */
export async function updateWorkspace(input: z.input<typeof workspaceSchema>) {
  const ctx = await requireManager()
  const parsed = workspaceSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message }

  const before = await prisma.workspace.findFirst()
  if (!before) return { ok: false as const, error: 'No workspace configured.' }

  const after = await prisma.workspace.update({ where: { id: before.id }, data: parsed.data })

  await writeAudit({
    actorId: ctx.user.id,
    action: 'workspace.update',
    entityType: 'Workspace',
    entityId: before.id,
    before: {
      name: before.name,
      dayBoundaryTimezone: before.dayBoundaryTimezone,
      funnelBaseUrl: before.funnelBaseUrl,
      attributionWindowH: before.attributionWindowH,
    },
    after: {
      name: after.name,
      dayBoundaryTimezone: after.dayBoundaryTimezone,
      funnelBaseUrl: after.funnelBaseUrl,
      attributionWindowH: after.attributionWindowH,
    },
  })

  revalidatePath('/settings')
  return {
    ok: true as const,
    boundaryChanged: before.dayBoundaryTimezone !== after.dayBoundaryTimezone,
  }
}
