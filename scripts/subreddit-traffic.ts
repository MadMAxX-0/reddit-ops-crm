/** Measure how busy each subreddit is. `npm run subreddit:traffic [-- --limit 60]` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { measureTraffic } from '../src/lib/jobs/subreddit-traffic'

async function main() {
  const i = process.argv.indexOf('--limit')
  const limit = i === -1 ? 40 : Number(process.argv[i + 1])
  console.log(await measureTraffic({ limit }))
  const top = await prisma.discoveredSubreddit.findMany({
    where: { postsPerDay: { not: null } },
    select: { name: true, subscribers: true, postsPerDay: true },
    orderBy: { postsPerDay: 'desc' },
    take: 15,
  })
  console.log('\nbusiest measured so far:')
  for (const t of top)
    console.log(
      '  r/' + t.name.padEnd(24),
      String(t.subscribers ?? 0).padStart(9),
      'subs ·',
      String(t.postsPerDay).padStart(6),
      'posts/day',
    )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
