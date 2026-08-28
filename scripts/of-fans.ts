/** Pull every subscriber with the date they actually subscribed. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyApi } from '../src/lib/onlyfans/theonlyapi'
import { syncFans } from '../src/lib/onlyfans/campaigns'

async function main() {
  const api = onlyApi()
  if (!api) {
    console.error('ONLYAPI_KEY / ONLYAPI_CRM_ID not set')
    process.exit(1)
  }
  let last = ''
  const r = await syncFans(api, (account, n, total) => {
    if (account !== last) {
      process.stdout.write(`\n  ${account}: `)
      last = account
    }
    process.stdout.write(`${n}${total ? `/${total}` : ''} `)
  })
  console.log(`\n\nstored ${r.rows} fans across ${r.accounts} accounts`)
  for (const e of r.errors) console.log(`  ! ${e}`)
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
