/** Pull who came through which tracking link, and every payment with its fan. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyApi } from '../src/lib/onlyfans/theonlyapi'
import { syncClaimsAndTransactions } from '../src/lib/onlyfans/campaigns'

async function main() {
  const api = onlyApi()
  if (!api) {
    console.error('ONLYAPI_KEY / ONLYAPI_CRM_ID not set')
    process.exit(1)
  }
  const r = await syncClaimsAndTransactions(api)
  console.log(`claims ${r.claims} across ${r.campaigns} links · transactions ${r.transactions}`)
  for (const e of r.errors.slice(0, 10)) console.log(`  ! ${e}`)
  if (r.errors.length > 10) console.log(`  ... and ${r.errors.length - 10} more`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
