import { prisma } from '@/lib/prisma'
import { maskSecret } from '@/lib/crypto'
import type { Ctx } from '@/lib/session'
import { accountScopeWhere } from './accounts'

/** Everything the detail drawer shows. Credentials leave here masked. */
export async function getAccountDetail(ctx: Ctx, accountId: string) {
  const account = await prisma.redditAccount.findFirst({
    where: { AND: [{ id: accountId }, accountScopeWhere(ctx)] },
    include: {
      proxy: true,
      assignedCreator: { select: { id: true, stageName: true } },
      assignedPoster: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      creationAttempt: { include: { proxy: { select: { label: true } } } },
      trackedLinks: { orderBy: { issuedAt: 'desc' } },
    },
  })
  if (!account) return null

  const [assignments, posts, karma, sessions, funnelAgg] = await Promise.all([
    prisma.accountAssignment.findMany({
      where: { redditAccountId: accountId },
      orderBy: { startedAt: 'desc' },
      include: {
        creator: { select: { stageName: true } },
        poster: { select: { name: true } },
      },
    }),
    prisma.post.findMany({
      where: { redditAccountId: accountId },
      orderBy: { postedAt: 'desc' },
      take: 60,
      select: {
        id: true,
        title: true,
        postedAt: true,
        firstSeenAt: true,
        status: true,
        latestUpvotes: true,
        latestComments: true,
        removalReason: true,
        url: true,
        subreddit: { select: { name: true, tier: true } },
        poster: { select: { name: true } },
        creator: { select: { stageName: true } },
      },
    }),
    prisma.accountHealthSnapshot.findMany({
      where: { redditAccountId: accountId },
      orderBy: { capturedAt: 'asc' },
      select: {
        capturedAt: true,
        karmaPost: true,
        karmaComment: true,
        followers: true,
        healthScore: true,
      },
    }),
    prisma.farmingSession.findMany({
      where: { redditAccountId: accountId },
      orderBy: { startedAt: 'desc' },
      take: 25,
      include: { farmer: { select: { name: true } } },
    }),
    prisma.funnelEvent.groupBy({
      by: ['type'],
      where: { trackedLink: { redditAccountId: accountId }, isBot: false },
      _count: { _all: true },
    }),
  ])

  const landings = funnelAgg.find((f) => f.type === 'LANDED')?._count._all ?? 0
  const outbound = funnelAgg.find((f) => f.type === 'OUTBOUND')?._count._all ?? 0

  return {
    account: {
      ...account,
      // never send ciphertext or plaintext to the client; reveal is a separate,
      // audited server action
      passwordEnc: undefined,
      passwordMasked: maskSecret('••••••••••'),
    },
    assignments,
    posts,
    karma,
    sessions,
    funnel: { landings, outbound },
  }
}

export type AccountDetail = NonNullable<Awaited<ReturnType<typeof getAccountDetail>>>
