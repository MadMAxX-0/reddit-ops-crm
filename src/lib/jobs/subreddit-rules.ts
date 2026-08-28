import { prisma } from '@/lib/prisma'
import { redditProvider } from '@/lib/reddit'
import { getJobConfig } from './config'
import { runJob, type JobResult } from './runner'
import { notifyManagers } from './notify'

/**
 * Job 5 — subreddit rules. Weekly refresh of rules, verification requirements
 * and subscriber counts.
 *
 * Tier is left alone: it is a judgement about where our traffic converts, not
 * a property of the subreddit, and the monthly intelligence report is what
 * proposes changing it.
 */
export async function runSubredditRules(opts: { limit?: number; names?: string[] } = {}) {
  return runJob(
    'SUBREDDIT_RULES',
    opts.names?.join(',') ?? null,
    async (ctx): Promise<JobResult> => {
      const config = await getJobConfig('SUBREDDIT_RULES')
      if (config.paused) return { itemsProcessed: 0, errorsCount: 0, detail: { skipped: 'paused' } }

      const provider = redditProvider()
      const now = new Date()
      const staleBefore = new Date(now.getTime() - 7 * 86_400_000)

      const subs = await prisma.subreddit.findMany({
        where: opts.names
          ? { name: { in: opts.names } }
          : { OR: [{ lastScrapedAt: null }, { lastScrapedAt: { lt: staleBefore } }] },
        orderBy: { lastScrapedAt: 'asc' },
        take: opts.limit ?? 40,
        select: {
          id: true,
          name: true,
          subscribers: true,
          status: true,
          verificationRequired: true,
        },
      })

      let updated = 0
      let gone = 0
      let errors = 0
      let lastError: string | null = null
      const shrinking: string[] = []

      for (const sub of subs) {
        try {
          const snapshot = await provider.getSubreddit(sub.name)
          if (!snapshot.exists || snapshot.private) {
            await prisma.subreddit.update({
              where: { id: sub.id },
              data: {
                status: 'BANNED_FOR_US',
                lastScrapedAt: now,
                rulesSummary: snapshot.private
                  ? 'Subreddit went private. Nothing can be posted here.'
                  : 'Subreddit no longer resolves. Treat as gone.',
              },
            })
            gone += 1
            continue
          }

          // a sub losing 15%+ of its subscribers in a week is usually a ban wave
          if (sub.subscribers > 0 && snapshot.subscribers < sub.subscribers * 0.85) {
            shrinking.push(sub.name)
          }

          await prisma.subreddit.update({
            where: { id: sub.id },
            data: {
              subscribers: snapshot.subscribers,
              isNsfw: snapshot.isNsfw,
              verificationRequired: snapshot.verificationRequired || sub.verificationRequired,
              allowedFlairs: snapshot.allowedFlairs.length ? snapshot.allowedFlairs : undefined,
              rulesSummary: snapshot.rulesSummary ?? undefined,
              lastScrapedAt: now,
            },
          })
          updated += 1
        } catch (err) {
          errors += 1
          lastError = err instanceof Error ? `r/${sub.name}: ${err.message}` : String(err)
        }
        ctx.progress(updated + gone, errors)
      }

      if (shrinking.length) {
        await notifyManagers({
          severity: 'WARN',
          title: `${shrinking.length} subreddit${shrinking.length === 1 ? '' : 's'} lost subscribers sharply`,
          body: shrinking.map((n) => `r/${n}`).join(', '),
          href: '/admin/subreddits',
          entityType: 'Subreddit',
        })
      }

      return {
        itemsProcessed: updated + gone,
        errorsCount: errors,
        lastError,
        detail: { updated, gone },
      }
    },
  )
}
