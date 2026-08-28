import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getWorkspace } from '@/lib/workspace'
import { canAccess, isManager, type Role } from '@/lib/rbac'

export interface Ctx {
  user: {
    id: string
    name: string
    email: string
    role: Role
    /** IANA zone the viewer sees timestamps in */
    timezone: string
    dailyAccountGoal: number
    dailyPostGoal: number
  }
  workspace: {
    id: string
    name: string
    /** IANA zone that defines what "a day" is for every aggregate */
    dayBoundaryTimezone: string
    funnelBaseUrl: string
    attributionWindowH: number
  }
  isManager: boolean
}

/** Every server component in the (app) group starts here. */
export async function requireCtx(): Promise<Ctx> {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    getWorkspace(),
  ])
  if (!user || user.status !== 'ACTIVE') redirect('/login')

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      timezone: user.timezone,
      dailyAccountGoal: user.dailyAccountGoal,
      dailyPostGoal: user.dailyPostGoal,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      dayBoundaryTimezone: workspace.dayBoundaryTimezone,
      funnelBaseUrl: workspace.funnelBaseUrl,
      attributionWindowH: workspace.attributionWindowH,
    },
    isManager: isManager(user.role as Role),
  }
}

/** Belt-and-braces: the middleware guards routes, this guards data access. */
export async function requireRoute(pathname: string): Promise<Ctx> {
  const ctx = await requireCtx()
  if (!canAccess(ctx.user.role, pathname)) redirect('/dashboard?denied=1')
  return ctx
}

export async function requireManager(): Promise<Ctx> {
  const ctx = await requireCtx()
  if (!ctx.isManager) redirect('/dashboard?denied=1')
  return ctx
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireCtx()
  if (ctx.user.role !== 'ADMIN') redirect('/dashboard?denied=1')
  return ctx
}

/**
 * Resolves the "whose numbers am I looking at" question in one place.
 * VAs are always scoped to themselves; managers may widen to everyone via the
 * Me / Everyone toggle, or drill into one VA.
 */
export function scopeUserId(ctx: Ctx, params: { scope?: string; va?: string }): string | null {
  if (!ctx.isManager) return ctx.user.id
  if (params.va) return params.va
  if (params.scope === 'me') return ctx.user.id
  return null // everyone
}
