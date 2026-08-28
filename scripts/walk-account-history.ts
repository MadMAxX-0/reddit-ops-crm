/**
 * Walk every account's whole submitted history once.
 *   npm run accounts:history
 *
 * The incremental poll can only ever move forward, so an account that posted
 * before its first poll had that history permanently out of reach. This walks
 * from the top of the timeline with no date floor and stamps `historyWalkedAt`
 * so it happens once per account, not on every poll.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { runPostDiscovery } from '../src/lib/jobs/discovery'

async function main() {
  // A walk is only as good as the moment it ran. u/No_Oven8872 served 4 posts
  // during one walk and 25 twenty minutes later, so a single clean pass is not
  // proof of a complete history — `--force` re-walks accounts already stamped.
  const force = process.argv.includes('--force')
  if (force) {
    const { count } = await prisma.redditAccount.updateMany({ data: { historyWalkedAt: null } })
    console.log(`--force: cleared the walk stamp on ${count} accounts`)
  }
  const todo = await prisma.redditAccount.findMany({
    where: { historyWalkedAt: null },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  })
  console.log(`${todo.length} accounts to walk`)

  let inserted = 0
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    const res = await runPostDiscovery({ accountIds: [a.id] })
    const n = (res.detail as { inserted?: number })?.inserted ?? 0
    inserted += n
    if (n) console.log(`  ${i + 1}/${todo.length} u/${a.username} -> +${n}`)
  }
  console.log(`\ninserted ${inserted} posts`)
  console.log(`Post rows now: ${await prisma.post.count()}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
