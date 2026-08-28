import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Credential reveals, account reassignments and role changes are ALWAYS logged.
 * The log is append-only and there is deliberately no update or delete path.
 */
export async function writeAudit(entry: {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: Prisma.InputJsonValue | null
  after?: Prisma.InputJsonValue | null
}) {
  let ip: string | null = null
  try {
    const h = await headers()
    ip = h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? null
  } catch {
    // called outside a request (a job); no IP to record
  }

  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? undefined,
      after: entry.after ?? undefined,
      ip,
    },
  })
}

export const AUDIT_ACTIONS = {
  CREDENTIAL_REVEAL: 'credential.reveal',
  ACCOUNT_CREATE: 'account.create',
  ACCOUNT_REASSIGN: 'account.reassign',
  ACCOUNT_RETIRE: 'account.retire',
  ACCOUNT_SUSPEND: 'account.suspend',
  ATTEMPT_CREATE: 'attempt.create',
  ATTRIBUTION_RESOLVE: 'post.attribution_resolve',
  SUBREDDIT_TIER: 'subreddit.tier_change',
  USER_ROLE: 'user.role_change',
  REPORT_GENERATE: 'report.generate',
  SCRAPER_CONFIG: 'scraper.config_change',
  SCRAPER_RUN: 'scraper.manual_run',
  LINK_TRACKING: 'oflink.tracking_change',
} as const
