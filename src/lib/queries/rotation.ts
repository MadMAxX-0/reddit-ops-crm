import type { Prisma } from '@/generated/prisma/client'

/**
 * The one definition of "an account we are actually running".
 *
 * Every figure the dashboard shows about posting is scoped by this. It lives in
 * its own module because it was previously written inline in one query and
 * missed in another: the summary cards counted only accounts in rotation while
 * "Best performing posts" ranked the whole database, so the top of the leader
 * board was r/VoidCats, r/blackcats and three hentai subs — karma farming by
 * warming accounts, presented as the operation's best work.
 *
 * Farming is real work and it is measured on the pipeline screen. It is not
 * reach, and it does not belong in a figure about reach.
 */
export const IN_ROTATION = {
  redditAccount: { pipelineStage: 'ACTIVE' as const },
} satisfies Prisma.PostWhereInput

/** Same rule, for queries that filter accounts rather than posts. */
export const ROTATION_ACCOUNT = { pipelineStage: 'ACTIVE' as const }
