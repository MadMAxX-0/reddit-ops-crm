/**
 * Mark subreddits as farming or promo.
 *   npm run subreddit:purpose                      -- show the current split
 *   npm run subreddit:purpose -- --farming a,b,c   -- mark these as farming
 *   npm run subreddit:purpose -- --promo a,b,c     -- mark these as promo
 *
 * Everything defaults to PROMO, so this only ever needs to name the exceptions.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

function names(flag: string): string[] {
  const i = process.argv.indexOf(flag)
  if (i === -1) return []
  return (process.argv[i + 1] ?? '')
    .split(',')
    .map((n) => n.trim().replace(/^\/?r\//i, ''))
    .filter(Boolean)
}

async function main() {
  for (const [flag, purpose] of [
    ['--farming', 'FARMING'],
    ['--promo', 'PROMO'],
  ] as const) {
    const list = names(flag)
    if (!list.length) continue
    // case-insensitive: r/femboys and r/FemBoys are one subreddit
    const rows = await prisma.subreddit.findMany({
      where: { OR: list.map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })) },
      select: { id: true, name: true },
    })
    await prisma.subreddit.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { purpose },
    })
    const found = new Set(rows.map((r) => r.name.toLowerCase()))
    const missing = list.filter((n) => !found.has(n.toLowerCase()))
    console.log(
      `${purpose}: ${rows.length} updated${missing.length ? ` · not found: ${missing.join(', ')}` : ''}`,
    )
  }

  const g = await prisma.subreddit.groupBy({ by: ['purpose'], _count: true })
  console.log('\nsubreddits:', g.map((x) => `${x.purpose}=${x._count}`).join('  '))
  const farming = await prisma.subreddit.findMany({
    where: { purpose: 'FARMING' },
    select: { name: true, _count: { select: { posts: true } } },
    orderBy: { name: 'asc' },
  })
  const posts = farming.reduce((s, f) => s + f._count.posts, 0)
  console.log(`farming subs hold ${posts} posts:`, farming.map((f) => 'r/' + f.name).join(', '))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
