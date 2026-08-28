/**
 * What a niche actually looks like once its rules have been read.
 *   npm run niche:report -- "Trans / Femboy"
 *
 * `?` in a requirement column means NOT STATED — the rules do not mention it.
 * It never means "no". A subreddit that publishes no rules is the riskiest kind
 * to post in, not the safest: the rules exist in the mods' heads either way.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

const b = (v: boolean | null) => (v === null ? ' ? ' : v ? 'YES' : ' - ')
const n = (v: number | null) => (v === null ? '  ?' : String(v).padStart(3))

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('usage: npm run niche:report -- "<niche name>"')
    process.exit(1)
  }
  const where = { nicheItems: { some: { niche: { name } } } }
  const rows = await prisma.discoveredSubreddit.findMany({
    where,
    orderBy: [{ unavailable: 'asc' }, { subscribers: 'desc' }],
    select: {
      name: true,
      subscribers: true,
      over18: true,
      ruleCount: true,
      unavailable: true,
      minKarma: true,
      minAccountAgeDays: true,
      requiresVerification: true,
      originalContentOnly: true,
      bansAskingForUpvotes: true,
    },
  })
  if (!rows.length) {
    console.error(`no subreddits filed under "${name}"`)
    process.exit(1)
  }

  const live = rows.filter((r) => !r.unavailable)
  const dead = rows.filter((r) => r.unavailable)

  console.log(
    'SUBREDDIT'.padEnd(26),
    'SUBS'.padStart(8),
    'RULES'.padStart(5),
    'KARMA',
    ' AGE',
    'VERIF',
    'OC ',
    'BAIT',
    '18+',
  )
  for (const r of live) {
    console.log(
      ('r/' + r.name).padEnd(26),
      String(r.subscribers ?? '?').padStart(8),
      String(r.ruleCount ?? '?').padStart(5),
      n(r.minKarma),
      n(r.minAccountAgeDays),
      ' ' + b(r.requiresVerification),
      b(r.originalContentOnly),
      b(r.bansAskingForUpvotes),
      r.over18 ? 'yes' : ' NO',
    )
  }

  if (dead.length) {
    console.log(`\nDEAD — Reddit will not serve these (banned, private, or gone):`)
    for (const r of dead) console.log('  r/' + r.name)
  }

  const reach = live.reduce((a, r) => a + (r.subscribers ?? 0), 0)
  const count = (f: (r: (typeof rows)[number]) => boolean) => live.filter(f).length
  console.log(`\n"${name}" — ${live.length} live, ${dead.length} dead`)
  console.log(`  combined reach        : ${reach.toLocaleString()}`)
  console.log(`  verification required : ${count((r) => r.requiresVerification === true)}`)
  console.log(`  karma floor stated    : ${count((r) => r.minKarma !== null)}`)
  console.log(`  age floor stated      : ${count((r) => r.minAccountAgeDays !== null)}`)
  console.log(`  original content only : ${count((r) => r.originalContentOnly === true)}`)
  console.log(`  bans upvote baiting   : ${count((r) => r.bansAskingForUpvotes === true)}`)
  console.log(
    `  publish NO rules      : ${count((r) => r.ruleCount === 0)}  <- read before posting`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
