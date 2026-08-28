/** Walk comment history for the accounts in rotation. `npm run accounts:comments` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { runCommentDiscovery } from '../src/lib/jobs/comment-discovery'

async function main() {
  const res = await runCommentDiscovery({ maxPages: 6 })
  console.log(res)
  const g = await prisma.redditComment.groupBy({ by: ['redditAccountId'], _count: true })
  const names = await prisma.redditAccount.findMany({
    where: { id: { in: g.map((x) => x.redditAccountId) } },
    select: { id: true, username: true },
  })
  const byId = new Map(names.map((n) => [n.id, n.username]))
  console.log('\ncomments per account:')
  for (const x of g.sort((a, b) => b._count - a._count))
    console.log('  u/' + (byId.get(x.redditAccountId) ?? '?').padEnd(24), x._count)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
