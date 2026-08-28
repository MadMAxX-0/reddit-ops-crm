/** Pull bouncy.ai links and their daily click history. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { bouncy } from '../src/lib/bouncy/client'
import { syncBouncy } from '../src/lib/bouncy/sync'

async function main() {
  const client = bouncy()
  if (!client) {
    console.error('BOUNCY_KEY not set')
    process.exit(1)
  }
  const r = await syncBouncy(client)
  console.log(
    `${r.links} bouncy links · ${r.matched} matched to a tracking link · ${r.dayRows} click-days`,
  )
  for (const u of r.unmatched) console.log(`  unmatched: ${u}`)
  for (const e of r.errors) console.log(`  ! ${e}`)
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
