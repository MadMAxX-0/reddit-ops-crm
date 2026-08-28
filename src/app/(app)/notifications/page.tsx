import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { NotificationList } from './notification-list'

export const metadata = { title: 'Notifications · Reddit Ops CRM' }

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v
}

export default async function NotificationsPage(props: PageProps<'/notifications'>) {
  const sp = await props.searchParams
  const ctx = await requireCtx()
  const unreadOnly = one(sp.unread) === '1'

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: ctx.user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ])

  return (
    <>
      <PageHeader
        title="Notifications"
        context={`${unread} unread · post removals, suspensions, goal misses and scraper failures`}
      />
      <NotificationList
        notifications={notifications.map((n) => ({
          id: n.id,
          severity: n.severity,
          title: n.title,
          body: n.body,
          href: n.href,
          readAt: n.readAt,
          createdAt: n.createdAt,
        }))}
        unread={unread}
        unreadOnly={unreadOnly}
        displayTz={ctx.user.timezone}
      />
    </>
  )
}
