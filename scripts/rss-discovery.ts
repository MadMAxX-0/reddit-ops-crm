/** Discover posts through Reddit's own feed. `npm run posts:rss` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { runRssDiscovery } from '../src/lib/jobs/rss-discovery'

async function main() {
  const before = await prisma.post.count()
  const res = await runRssDiscovery({ onProgress: (l) => console.log('  ' + l) })
  console.log(res)
  console.log(`posts: ${before} -> ${await prisma.post.count()}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
