import { SessionProvider } from 'next-auth/react'
import { IconRail } from '@/components/shell/icon-rail'
import { TopBar } from '@/components/shell/top-bar'
import { navFor } from '@/lib/rbac'
import { requireCtx } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const ctx = await requireCtx()
  const unread = await prisma.notification.count({
    where: { userId: ctx.user.id, readAt: null },
  })

  return (
    <SessionProvider>
      <div className="bg-root flex min-h-dvh">
        <IconRail items={navFor(ctx.user.role)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar workspaceName={ctx.workspace.name} user={ctx.user} unreadCount={unread} />
          {/* hairline rules mark the edges of the content column */}
          <main className="border-hairline mx-auto w-full max-w-[1600px] flex-1 border-x px-6 py-5">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  )
}
