import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { PageHeader } from '@/components/shell/page-header'
import { Planner } from './planner'

export const metadata = { title: 'Posting · Reddit Ops CRM' }

/**
 * Today's posting order, per account.
 *
 * A manager picks the account, the subreddit list and how many posts that
 * account gets, chooses how the list should be sorted, and hands the result to
 * whoever is doing the posting. The ordering rules live in `lib/posting/order`;
 * this screen is only the choosing.
 */
export default async function PostingPage() {
  const ctx = await requireCtx()

  const [accounts, niches] = await Promise.all([
    prisma.redditAccount.findMany({
      where: {
        pipelineStage: 'ACTIVE',
        ...(ctx.isManager ? {} : { assignedPosterId: ctx.user.id }),
      },
      orderBy: { username: 'asc' },
      select: { id: true, username: true, assignedCreator: { select: { stageName: true } } },
    }),
    prisma.subredditNiche.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true, _count: { select: { items: true } } },
    }),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Posting"
        context="Pick the account, the list and how many posts — the order comes back sorted"
      />
      <Planner
        accounts={accounts.map((a) => ({
          id: a.id,
          username: a.username,
          model: a.assignedCreator?.stageName ?? null,
        }))}
        niches={niches.map((n) => ({
          id: n.id,
          name: n.name,
          color: n.color,
          count: n._count.items,
        }))}
      />
    </div>
  )
}
