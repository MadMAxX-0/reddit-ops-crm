/**
 * Re-check every post recorded as removed, and put back the ones that are not.
 *   npm run posts:repair
 *
 * The removal job used to treat a single 404 as proof. The host returns 404 for
 * posts that are plainly live, so a share of the "removed" pile is fiction —
 * and a false removal is not one bad row, it drags the survival rate down and
 * makes a working subreddit look hostile.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { redditProvider } from '../src/lib/reddit'
import { classifyRemoval } from '../src/lib/reddit/removal-cause'

async function main() {
  const provider = redditProvider()
  const rows = await prisma.post.findMany({
    where: { status: { in: ['REMOVED', 'DELETED'] } },
    select: { id: true, redditPostId: true, status: true, removedBy: true },
    orderBy: { postedAt: 'desc' },
  })
  console.log(`re-checking ${rows.length} posts recorded as removed`)

  let restored = 0
  let confirmed = 0
  let reclassified = 0
  let skipped = 0

  for (const r of rows) {
    // A network failure is not evidence about the post. Skip the row and leave
    // it exactly as it was rather than crashing the pass or, worse, reading the
    // error as a disappearance.
    const look = async () => {
      try {
        return await provider.getPost(r.redditPostId)
      } catch {
        return null
      }
    }
    let s = await look()
    if (!s || s.missing) {
      await new Promise((x) => setTimeout(x, 2_000))
      s = (await look()) ?? s
    }
    if (!s) {
      skipped += 1
      continue
    }

    if (!s.missing && !s.removed && !s.deleted) {
      await prisma.post.update({
        where: { id: r.id },
        data: {
          status: 'LIVE',
          removedAt: null,
          removalReason: null,
          removedBy: null,
          latestUpvotes: s.upvotes,
          latestComments: s.comments,
          latestUpvoteRatio: s.upvoteRatio,
          lastMetricAt: new Date(),
        },
      })
      restored += 1
      continue
    }

    // still gone — but the reason may be readable now even if it was not before
    const cause = classifyRemoval(s.removalReason ?? 'not returned by api', r.status)
    if (cause && cause !== r.removedBy) {
      await prisma.post.update({ where: { id: r.id }, data: { removedBy: cause } })
      reclassified += 1
    }
    confirmed += 1
  }

  console.log(`\nrestored to live : ${restored}`)
  console.log(`still removed    : ${confirmed} (${reclassified} got a clearer cause)`)
  if (skipped) console.log(`unreachable      : ${skipped} left untouched`)

  const g = await prisma.post.groupBy({
    by: ['removedBy'],
    _count: true,
    where: { status: { in: ['REMOVED', 'DELETED'] } },
  })
  console.log('causes now       :', g.map((x) => `${x.removedBy ?? 'null'}=${x._count}`).join('  '))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
