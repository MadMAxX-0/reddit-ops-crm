/** Preview a day's posting order. `npm run plan -- u/Account "Trans" 15 members` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { candidatesFor, planDay, type Strategy } from '../src/lib/posting/order'

async function main() {
  const [rawUser, niche, rawSlots, rawStrategy] = process.argv.slice(2)
  const username = (rawUser ?? 'Slow-Pea2845').replace(/^u\//, '')
  const slots = Number(rawSlots ?? 15)
  const strategies: Strategy[] = rawStrategy
    ? [rawStrategy as Strategy]
    : ['members', 'ourResults', 'traffic']

  const account = await prisma.redditAccount.findFirstOrThrow({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true, username: true, karmaPost: true, karmaComment: true },
  })

  const { candidates, excluded } = await candidatesFor({
    nicheName: niche ?? 'Trans',
    redditAccountId: account.id,
  })
  console.log(
    `u/${account.username} · list "${niche ?? 'Trans'}" · ${candidates.length} usable of ${
      candidates.length + excluded.length
    } · ${slots} slots/day`,
  )
  const why = new Map<string, number>()
  for (const e of excluded) {
    const k = e.why.replace(/\d+/g, 'N')
    why.set(k, (why.get(k) ?? 0) + 1)
  }
  console.log('  excluded:', [...why].map(([k, n]) => `${n} ${k}`).join(' · '))

  for (const s of strategies) {
    const plan = planDay(candidates, slots, s)
    console.log(`\n── ${s} ──`)
    for (const p of plan) {
      const c = candidates.find((x) => x.name === p.subreddit)!
      console.log(
        `  ${String(p.position).padStart(2)}. ${p.tier}  r/${p.subreddit.padEnd(24)} ` +
          `rank ${String(p.rank).padStart(8)}  ` +
          `${String(c.subscribers ?? 0).padStart(9)} subs  ` +
          `${c.postsPerDay ? String(c.postsPerDay).padStart(6) + '/day' : '   no traffic'}  ` +
          `${c.ourPosts ? `ours ~${c.ourMedian}↑ (${c.ourPosts})` : ''}`,
      )
    }
    const tiers = plan.reduce<Record<string, number>>((a, p) => {
      a[p.tier] = (a[p.tier] ?? 0) + 1
      return a
    }, {})
    console.log(
      '  tiers:',
      Object.entries(tiers)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
