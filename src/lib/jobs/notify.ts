import { prisma } from '@/lib/prisma'
import type { Severity } from '@/generated/prisma/client'

/**
 * In-app bell plus an optional outbound webhook. A failed webhook never fails
 * the job — a dropped Slack message is annoying, a dropped scrape is data loss.
 */
export async function notify(opts: {
  userIds: string[]
  severity: Severity
  title: string
  body?: string | null
  href?: string | null
  entityType?: string
  entityId?: string | null
}) {
  if (opts.userIds.length) {
    await prisma.notification.createMany({
      data: opts.userIds.map((userId) => ({
        userId,
        severity: opts.severity,
        title: opts.title,
        body: opts.body ?? null,
        href: opts.href ?? null,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
      })),
    })
  }
  await postWebhook(opts.severity, opts.title, opts.body ?? undefined)
}

export async function notifyManagers(opts: Omit<Parameters<typeof notify>[0], 'userIds'>) {
  const managers = await prisma.user.findMany({
    where: { role: { in: ['MANAGER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { id: true },
  })
  await notify({ ...opts, userIds: managers.map((m) => m.id) })
}

async function postWebhook(severity: Severity, title: string, body?: string) {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return
  const icon = severity === 'CRITICAL' ? '🔴' : severity === 'WARN' ? '🟠' : '🔵'
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${icon} *${title}*${body ? `\n${body}` : ''}` }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.warn('[notify] webhook failed:', err instanceof Error ? err.message : err)
  }
}
