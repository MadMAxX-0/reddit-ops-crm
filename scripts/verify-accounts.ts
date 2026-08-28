/**
 * Checks every account in the pipeline against Reddit and fills in the facts we
 * can actually observe: karma, real account age, and whether the profile still
 * resolves.
 *
 * It deliberately does NOT auto-flag anything as banned. A profile that fails
 * to resolve might be banned, deleted, renamed, or the API might be having a
 * bad minute — and silently marking 40 accounts dead because of a provider
 * hiccup is far worse than a stale flag. Mismatches are reported for a human.
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { redditProvider } from '../src/lib/reddit'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const provider = redditProvider()
  const accounts = await prisma.redditAccount.findMany({
    where: { status: { not: 'RETIRED' } },
    orderBy: { username: 'asc' },
    select: { id: true, username: true, flag: true, pipelineStage: true },
  })

  console.log(`checking ${accounts.length} accounts against ${provider.name}\n`)

  let alive = 0
  let missing = 0
  let errors = 0
  const disagreements: string[] = []

  for (const a of accounts) {
    try {
      const snap = await provider.getAccount(a.username)

      if (!snap.exists) {
        missing++
        if (a.flag !== 'BANNED') {
          disagreements.push(
            `  u/${a.username.padEnd(22)} ${a.pipelineStage.padEnd(8)} not on Reddit, but flagged "${a.flag}"`,
          )
        }
        continue
      }

      alive++
      if (a.flag === 'BANNED') {
        disagreements.push(
          `  u/${a.username.padEnd(22)} ${a.pipelineStage.padEnd(8)} flagged Banned, but the profile resolves`,
        )
      }

      await prisma.redditAccount.update({
        where: { id: a.id },
        data: {
          karmaPost: snap.karmaPost,
          karmaComment: snap.karmaComment,
          redditCreatedAt: snap.createdAt ?? undefined,
          lastCheckedAt: new Date(),
        },
      })
    } catch (err) {
      errors++
      console.warn(`  ! u/${a.username}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log(`\n${alive} resolve on Reddit · ${missing} do not · ${errors} errors`)
  if (disagreements.length) {
    console.log(
      `\n${disagreements.length} disagree with the pipeline flag — nothing was changed automatically:`,
    )
    for (const d of disagreements) console.log(d)
  } else {
    console.log('\nevery pipeline flag agrees with Reddit')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
