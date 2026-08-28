/** Read the real rules for every subreddit in a niche. `npm run niche:enrich -- "Trans / Femboy"` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { enrichSubreddits } from '../src/lib/jobs/subreddit-enrich'

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('usage: npm run niche:enrich -- "<niche name>"')
    process.exit(1)
  }
  // Passing explicit names makes the enricher ignore its own staleness window
  // and re-read everything, so the freshness filter has to happen here: never
  // read, or read more than a fortnight ago. `--all` overrides it.
  const all = process.argv.includes('--all')
  const stale = new Date(Date.now() - 14 * 86_400_000)
  const items = await prisma.subredditNicheItem.findMany({
    where: { niche: { name } },
    select: { subreddit: true, discovered: { select: { rulesCheckedAt: true } } },
  })
  const names = items
    .filter((i) => all || !i.discovered?.rulesCheckedAt || i.discovered.rulesCheckedAt < stale)
    .map((i) => i.subreddit)
  console.log(`${items.length} subreddits in "${name}" — ${names.length} to read`)
  if (!names.length) {
    console.log('nothing stale; pass --all to force')
    return
  }
  const res = await enrichSubreddits({ names, limit: names.length })
  console.log(res)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
