'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'

export async function markRead(ids: string[]) {
  const ctx = await requireCtx()
  await prisma.notification.updateMany({
    // scoped to the caller: a notification id is not a capability
    where: { id: { in: ids }, userId: ctx.user.id, readAt: null },
    data: { readAt: new Date() },
  })
  revalidatePath('/notifications')
  return { ok: true as const }
}

export async function markAllRead() {
  const ctx = await requireCtx()
  const res = await prisma.notification.updateMany({
    where: { userId: ctx.user.id, readAt: null },
    data: { readAt: new Date() },
  })
  revalidatePath('/notifications')
  return { ok: true as const, count: res.count }
}
