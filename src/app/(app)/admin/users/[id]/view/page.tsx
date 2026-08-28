import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { navFor, landingFor, canAccess, NAV, ROLE_LABEL, type Role } from '@/lib/rbac'
import { RoleView } from './role-view'

export const metadata = { title: 'View as · Reddit Ops CRM' }

/**
 * What one person sees when they sign in.
 *
 * A preview, not a session swap. An admin checking "can Bev reach the audit
 * log" wants an answer they can trust in one glance, and borrowing her identity
 * to find out would put an admin's actions under her name in the audit log —
 * the one record that has to stay truthful. So this reads the same permission
 * table the app reads and renders the result.
 */
export default async function ViewAsPage({ params }: PageProps<'/admin/users/[id]/view'>) {
  const { id } = await params
  await requireAdmin()

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      timezone: true,
      dailyPostGoal: true,
      dailyAccountGoal: true,
      _count: { select: { assignedAccounts: true, createdAccounts: true, posts: true } },
    },
  })
  if (!user) notFound()

  const role = user.role as Role

  // Every route the rail can reach, plus the ones that are reachable but not
  // listed — those are the ones an admin would never think to check.
  const routes = NAV.map((item) => ({
    href: item.href,
    label: item.label,
    section: item.section,
    parked: !!item.parked,
    allowed: canAccess(role, item.href),
    inRail: item.section !== 'hidden' && item.roles.includes(role),
  }))

  return (
    <RoleView
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        roleLabel: ROLE_LABEL[role] ?? role,
        status: user.status,
        timezone: user.timezone,
        goal:
          role === 'FARMER'
            ? `${user.dailyAccountGoal} accounts/day`
            : role === 'POSTER'
              ? `${user.dailyPostGoal} posts/day`
              : 'not scored',
        accounts: role === 'FARMER' ? user._count.createdAccounts : user._count.assignedAccounts,
        accountsLabel: role === 'FARMER' ? 'made' : 'assigned',
        posts: user._count.posts,
      }}
      nav={navFor(role)}
      landing={landingFor(role)}
      routes={routes}
    />
  )
}
