/**
 * Loads the farming pipeline transcribed from the team's screens, and puts the
 * ten accounts already in rotation into the content-creation stage.
 *
 *   npm run db:seed:pipeline
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { encryptSecret } from '../src/lib/crypto'
// The roster is local-only. Without it there is nothing to seed, which is the
// correct behaviour on a fresh clone rather than an import error.
import { PIPELINE } from './roster.local'
import { ACCOUNTS } from './roster.local.data'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  let created = 0
  let updated = 0

  for (const row of PIPELINE) {
    const redditCreatedAt =
      row.ageDays == null ? null : new Date(Date.now() - row.ageDays * 86_400_000)

    const existing = await prisma.redditAccount.findUnique({
      where: { username: row.username },
      select: { id: true },
    })

    const data = {
      device: row.device,
      pipelineStage: row.stage,
      flag: row.flag,
      redditCreatedAt,
      // the pipeline's own flag is the source of truth for "is it dead"
      status: row.flag === 'BANNED' ? ('SUSPENDED' as const) : ('WARMING' as const),
      suspendedAt: row.flag === 'BANNED' ? new Date() : null,
    }

    if (existing) {
      await prisma.redditAccount.update({ where: { id: existing.id }, data })
      updated++
    } else {
      await prisma.redditAccount.create({
        data: {
          username: row.username,
          passwordEnc: encryptSecret('not-set'),
          emailAddress: '',
          healthScore: 0,
          pollTier: 'DORMANT',
          ...data,
        },
      })
      created++
    }
  }

  // the ten assigned to creators are Active
  const posting = await prisma.redditAccount.updateMany({
    where: { username: { in: ACCOUNTS.map((a) => a.username) } },
    data: { pipelineStage: 'ACTIVE' },
  })

  const byStage = await prisma.redditAccount.groupBy({
    by: ['pipelineStage'],
    _count: { _all: true },
  })

  console.log(`${created} created, ${updated} updated, ${posting.count} moved to Active`)
  for (const s of byStage) console.log(`  ${s.pipelineStage.padEnd(9)} ${s._count._all}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
