/** Read the watched accounts' timelines. `npm run spy` */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { runSpy } from '../src/lib/jobs/spy'

async function main() {
  const res = await runSpy({
    usernames: process.argv.slice(2).length ? process.argv.slice(2) : undefined,
  })
  console.log(res)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
