import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { UsersTable } from './users-table'

export const metadata = { title: 'Users · Reddit Ops CRM' }

export default async function UsersPage() {
  const ctx = await requireAdmin()

  const [users, creators] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ status: 'asc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        timezone: true,
        status: true,
        dailyAccountGoal: true,
        dailyPostGoal: true,
        hourlyCostCents: true,
        createdAt: true,
        creators: { select: { id: true, stageName: true } },
        _count: { select: { assignedAccounts: true, createdAccounts: true, posts: true } },
      },
    }),
    prisma.creator.findMany({
      where: { status: { not: 'CHURNED' } },
      orderBy: { stageName: 'asc' },
      select: { id: true, stageName: true },
    }),
  ])

  return (
    <>
      <PageHeader
        title="Users"
        context={`${users.filter((u) => u.status === 'ACTIVE').length} active · deactivation preserves history and hands the accounts on`}
      />
      <UsersTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          timezone: u.timezone,
          status: u.status,
          dailyAccountGoal: u.dailyAccountGoal,
          dailyPostGoal: u.dailyPostGoal,
          hourlyCostCents: u.hourlyCostCents,
          createdAt: u.createdAt,
          creatorIds: u.creators.map((c) => c.id),
          creatorNames: u.creators.map((c) => c.stageName),
          assignedAccounts: u._count.assignedAccounts,
          createdAccounts: u._count.createdAccounts,
          posts: u._count.posts,
        }))}
        creators={creators.map((c) => ({ id: c.id, name: c.stageName }))}
        currentUserId={ctx.user.id}
        displayTz={ctx.user.timezone}
      />
    </>
  )
}
