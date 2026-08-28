/** Match models to their OnlyFans accounts, once. Reports anything it will not guess. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { linkOfAccounts } from '../src/lib/jobs/of-sync-v2'

async function main() {
  const r = await linkOfAccounts()
  if (r.error) {
    console.error(r.error)
    process.exit(1)
  }
  console.log(`linked ${r.linked} model(s) to an OnlyFans account`)
  const linked = await prisma.creator.findMany({
    where: { ofUserId: { not: null } },
    select: { stageName: true, ofUsername: true, ofUserId: true },
    orderBy: { stageName: 'asc' },
  })
  for (const c of linked) console.log(`  ${c.stageName.padEnd(10)} → ${c.ofUsername} (${c.ofUserId})`)
  if (r.unmatchedCreators.length) console.log(`\nmodels with no OF account: ${r.unmatchedCreators.join(', ')}`)
  if (r.unmatchedApi.length) console.log(`OF accounts with no model:  ${r.unmatchedApi.join(', ')}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
