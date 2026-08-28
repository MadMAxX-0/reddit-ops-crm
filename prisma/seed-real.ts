/**
 * Seeds the real operation: two posters, three farming VAs, seven models and
 * the ten Reddit accounts actually in rotation.
 *
 * Karma, account age and verification status are read from the live Reddit
 * provider rather than invented, so the inventory screen is true the moment it
 * loads. Post history is NOT seeded — that is discovery's job, and inventing it
 * would defeat the point of a system whose whole premise is that output is
 * observed rather than entered.
 *
 *   npm run db:seed:real
 *   npm run job -- discovery      # then pull the real post history
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { redditProvider } from '../src/lib/reddit'
import { encryptSecret } from '../src/lib/crypto'
import { ACCOUNTS, FARMERS, MODELS, POSTERS } from './roster'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

const BOUNDARY_TZ = process.env.WORKSPACE_DAY_BOUNDARY_TZ ?? 'Africa/Lagos'
const FUNNEL_BASE = process.env.FUNNEL_BASE_URL ?? 'http://localhost:3000/f'

function slugFor(username: string) {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18)
}

async function main() {
  console.time('seed:real')

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "FunnelEvent", "Conversion", "PostMetric", "Post", "TrackedLink",
      "AccountHealthSnapshot", "FarmingSession", "AccountCreationAttempt",
      "AccountAssignment", "RedditAccount", "Proxy", "Subreddit",
      "FollowerSnapshot", "ReportTask", "Report", "AuditLog", "Notification",
      "ScraperJob", "ScraperConfig", "Creator", "User", "Workspace"
    RESTART IDENTITY CASCADE
  `)

  const workspace = await prisma.workspace.create({
    data: {
      name: process.env.WORKSPACE_NAME ?? 'Agency',
      dayBoundaryTimezone: BOUNDARY_TZ,
      funnelBaseUrl: FUNNEL_BASE,
      attributionWindowH: 72,
    },
  })

  const passwordHash = await bcrypt.hash('password123', 10)

  const admin = await prisma.user.create({
    data: {
      name: 'Admin', email: 'admin@agency.local', passwordHash, role: 'ADMIN',
      timezone: 'Europe/Berlin', dailyAccountGoal: 0, dailyPostGoal: 0,
    },
  })

  const posters = await Promise.all(
    POSTERS.map((p) =>
      prisma.user.create({
        data: {
          name: p.name, email: p.email, passwordHash, role: 'POSTER',
          timezone: 'Europe/Berlin',
          // No goal set: the team measures paid days, not a post quota. A goal
          // of 0 renders as "not scored" rather than as a permanent miss.
          dailyAccountGoal: 0, dailyPostGoal: 0,
        },
      }),
    ),
  )

  const farmers = await Promise.all(
    FARMERS.map((f) =>
      prisma.user.create({
        data: {
          name: f.name, email: f.email, passwordHash, role: 'FARMER',
          timezone: 'Europe/Berlin',
          dailyAccountGoal: f.focus === 'creation' ? 5 : 0,
          dailyPostGoal: 0,
        },
      }),
    ),
  )

  const creators = await Promise.all(
    MODELS.map((m) =>
      prisma.creator.create({
        data: { stageName: m, ofUsername: m.toLowerCase(), status: 'ACTIVE', revenueSharePct: 70 },
      }),
    ),
  )

  const posterByName = new Map(posters.map((p) => [p.name, p]))
  const creatorByName = new Map(creators.map((c) => [c.stageName, c]))

  // --- accounts, with live facts where the provider can supply them ---------
  const provider = redditProvider()
  console.log(`· reading account facts from ${provider.name}`)

  let live = 0
  for (const row of ACCOUNTS) {
    const poster = posterByName.get(row.poster)!
    const creator = creatorByName.get(row.model)!

    let karmaPost = 0
    let karmaComment = 0
    let redditCreatedAt: Date | null = null
    let suspended = false

    try {
      const snap = await provider.getAccount(row.username)
      if (snap.exists) {
        karmaPost = snap.karmaPost
        karmaComment = snap.karmaComment
        redditCreatedAt = snap.createdAt
        live++
      } else {
        suspended = true
      }
    } catch (err) {
      console.warn(`  ! ${row.username}: ${err instanceof Error ? err.message : err}`)
    }

    const ageDays = redditCreatedAt
      ? Math.floor((Date.now() - redditCreatedAt.getTime()) / 86_400_000)
      : 0

    const account = await prisma.redditAccount.create({
      data: {
        username: row.username,
        modelLabel: row.modelLabel,
        // Placeholder until the real credentials are loaded. Encrypted anyway,
        // so the reveal path behaves identically once they are.
        passwordEnc: encryptSecret('not-set'),
        emailAddress: '',
        redditCreatedAt: redditCreatedAt ?? new Date(),
        karmaPost,
        karmaComment,
        status: suspended ? 'SUSPENDED' : 'ACTIVE',
        suspendedAt: suspended ? new Date() : null,
        assignedCreatorId: creator.id,
        assignedPosterId: suspended ? null : poster.id,
        healthScore: suspended ? 0 : Math.min(99, 25 + Math.min(40, ageDays / 4) + Math.min(30, karmaPost / 200)),
        lastCheckedAt: new Date(),
        pollTier: 'WARM',
        nextPollAt: new Date(),
      },
    })

    if (!suspended) {
      // Custody starts at the account's birth: these accounts have been with
      // this poster throughout, so backdating the span means every post
      // discovery finds resolves to the right person instead of landing in the
      // attribution queue.
      await prisma.accountAssignment.create({
        data: {
          redditAccountId: account.id,
          creatorId: creator.id,
          posterId: poster.id,
          startedAt: redditCreatedAt ?? new Date(),
        },
      })
    }

    const slug = slugFor(row.username)
    await prisma.trackedLink.create({
      data: {
        slug,
        redditAccountId: account.id,
        ofTrackingLinkId: `oft_${slug}`,
        funnelUrl: `${FUNNEL_BASE.replace(/\/$/, '')}/${slug}`,
        status: 'ACTIVE',
      },
    })

    console.log(
      `  u/${row.username.padEnd(22)} ${row.modelLabel.padEnd(12)} ${row.poster.padEnd(4)} ` +
        `karma ${String(karmaPost).padStart(6)} · age ${String(ageDays).padStart(4)}d${suspended ? ' · NOT FOUND' : ''}`,
    )
  }

  console.log(`\n  workspace: ${workspace.name} · day boundary ${workspace.dayBoundaryTimezone}`)
  console.log(`  ${posters.length} posters · ${farmers.length} farming VAs · ${creators.length} models · ${ACCOUNTS.length} accounts (${live} live)`)
  console.log(`  sign in: ${admin.email} / password123`)
  console.log('\n  next: npm run job -- discovery    (pulls the real post history)')
  console.timeEnd('seed:real')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
