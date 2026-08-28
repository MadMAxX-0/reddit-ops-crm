/** Add watched accounts and read where they post. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { runSubredditDiscovery } from '../src/lib/jobs/subreddit-discovery'

async function main() {
  const names = process.argv.slice(2)
  if (names.length) {
    await prisma.scrapeTarget.createMany({
      data: names.map((username) => ({ username: username.replace(/^u\//i, '') })),
      skipDuplicates: true,
    })
    console.log(`watching ${names.length} account(s)`)
  }

  const r = await runSubredditDiscovery()
  console.log(JSON.stringify(r.detail ?? r, null, 2))

  const top = await prisma.discoveredSubreddit.findMany({
    orderBy: [{ targets: 'desc' }, { posts: 'desc' }],
    take: 15,
  })
  console.log('\ntop subreddits found:')
  for (const d of top) {
    console.log(
      `  r/${d.name.padEnd(28)} ${d.targets} account(s) · ${String(d.posts).padStart(3)} posts · avg ${String(d.avgScore).padStart(5)} · best ${d.bestScore}`,
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
