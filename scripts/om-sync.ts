/** Pull OnlyMonster's record of who arrived through which tracking link. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyMonster } from '../src/lib/onlymonster/client'
import { syncOnlyMonster } from '../src/lib/onlymonster/sync'

async function main() {
  const om = onlyMonster()
  if (!om) {
    console.error('ONLYMONSTER_TOKEN not set')
    process.exit(1)
  }
  let last = ''
  const r = await syncOnlyMonster(om, (account, rows) => {
    if (account !== last) {
      process.stdout.write(`\n  ${account}: `)
      last = account
    }
    process.stdout.write(`${rows} `)
  })
  console.log(`\n\nstored ${r.rows} link arrivals from ${r.accounts} OnlyMonster accounts`)
  if (r.skipped.length) console.log(`  not in this CRM, skipped: ${r.skipped.join(', ')}`)
  for (const e of r.errors) console.log(`  ! ${e}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
