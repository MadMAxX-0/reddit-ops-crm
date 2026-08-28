/**
 * Seed — builds a coherent 90-day operational history, not random noise.
 *
 * Coherence rules the generator obeys, because every screen depends on them:
 *   * a post can only exist on an account that already existed at postedAt
 *   * a post's creator/poster are read from AccountAssignment as of postedAt,
 *     so reassignments leave old numbers untouched
 *   * landings only ever exist for posts that got upvotes
 *   * conversions only ever exist behind an outbound click
 *   * daily buckets use the workspace day-boundary timezone, never the server's
 *
 * Volumes are env-tunable; defaults exceed the spec's floor so the virtualised
 * tables and 90-day charts have something real to strain against.
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { CREATORS, STAFF, SUBREDDITS, TITLE_TEMPLATES, REMOVAL_REASONS, EMAIL_PROVIDERS, COUNTRIES, DEVICES } from './seed-data'
import { makeRng, id, daysAgo, addMinutes, addHours, chunked, clampPast, type Rng } from './seed-util'
import { encryptSecret, privacyHash } from '../src/lib/crypto'
import { dayKey, dayDateColumn, dayBounds } from '../src/lib/time'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

const N = {
  historyDays: Number(process.env.SEED_HISTORY_DAYS ?? 90),
  /** How far back detailed farmer creation history goes. Long enough that some
   *  farmed accounts have aged past the 21-day warm-up, or "brought to ready"
   *  and "stuck in warm-up" both read zero for everyone and tell you nothing. */
  creationWindowDays: Number(process.env.SEED_CREATION_WINDOW_DAYS ?? 45),
  /** accounts that predate the CRM, imported at go-live — these carry the posts */
  importedAccounts: Number(process.env.SEED_IMPORTED_ACCOUNTS ?? 600),
  proxies: Number(process.env.SEED_PROXIES ?? 40),
}

const BOUNDARY_TZ = process.env.WORKSPACE_DAY_BOUNDARY_TZ ?? 'Africa/Lagos'
const FUNNEL_BASE = process.env.FUNNEL_BASE_URL ?? 'http://localhost:3000/f'
const rng = makeRng(20260820)

// ---------------------------------------------------------------------------

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function redditUsername(r: Rng): string {
  const a = ['sweet', 'lil', 'baby', 'kitten', 'velvet', 'moon', 'honey', 'silk', 'cherry', 'wild', 'shy', 'foxy', 'peach', 'rosy', 'star', 'lush', 'coco', 'bunny', 'misty', 'ivory']
  const b = ['rose', 'kate', 'lane', 'may', 'belle', 'jade', 'skye', 'wren', 'nova', 'reign', 'vale', 'lux', 'fawn', 'dove', 'ash', 'sage', 'quinn', 'nyx', 'lark', 'bree']
  return `${r.pick(a)}_${r.pick(b)}${r.int(11, 9999)}`
}

async function wipe() {
  // order matters — children first
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "FunnelEvent", "Conversion", "PostMetric", "Post", "TrackedLink",
      "AccountHealthSnapshot", "FarmingSession", "AccountCreationAttempt",
      "AccountAssignment", "RedditAccount", "Proxy", "Subreddit",
      "FollowerSnapshot", "Report", "AuditLog", "Notification",
      "ScraperJob", "ScraperConfig", "Creator", "User", "Workspace"
    RESTART IDENTITY CASCADE
  `)
}

// ---------------------------------------------------------------------------

async function main() {
  console.time('seed')
  console.log('· wiping')
  await wipe()

  // --- workspace ----------------------------------------------------------
  const workspace = await prisma.workspace.create({
    data: {
      name: process.env.WORKSPACE_NAME ?? 'Northstar Media',
      dayBoundaryTimezone: BOUNDARY_TZ,
      funnelBaseUrl: FUNNEL_BASE,
      attributionWindowH: 72,
    },
  })

  // --- staff --------------------------------------------------------------
  console.log('· staff')
  // one hash, reused: bcrypt is deliberately slow and we do not need 15 of them
  const passwordHash = await bcrypt.hash('password123', 10)
  const users = STAFF.map((s) => ({
    id: id(),
    name: s.name,
    email: s.email,
    passwordHash,
    role: s.role,
    timezone: s.timezone,
    dailyAccountGoal: s.accountGoal,
    dailyPostGoal: s.postGoal,
    hourlyCostCents: s.hourlyCostCents,
    status: 'ACTIVE' as const,
    createdAt: daysAgo(200),
  }))
  await prisma.user.createMany({ data: users })
  const farmers = users.filter((u) => u.role === 'FARMER')
  const posters = users.filter((u) => u.role === 'POSTER')
  const managers = users.filter((u) => u.role === 'MANAGER' || u.role === 'ADMIN')

  // --- creators -----------------------------------------------------------
  console.log('· creators')
  const creators = CREATORS.map((c, i) => ({
    id: id(),
    stageName: c.stageName,
    ofUsername: c.ofUsername,
    revenueSharePct: c.sharePct,
    status: c.status,
    niche: c.niche,
    avatarUrl: null,
    notes: i === 6 ? 'Paused since 2026-07-30 at the creator’s request. Accounts kept warm.' : null,
    createdAt: daysAgo(180 - i * 6),
  }))
  await prisma.creator.createMany({ data: creators })

  // each creator gets 2-3 posters who are allowed to work them
  for (const c of creators) {
    const chosen = rng.shuffle([...posters]).slice(0, rng.int(2, 3))
    await prisma.creator.update({
      where: { id: c.id },
      data: { posters: { connect: chosen.map((p) => ({ id: p.id })) } },
    })
  }

  // --- proxies ------------------------------------------------------------
  const proxies = Array.from({ length: N.proxies }, (_, i) => ({
    id: id(),
    label: `res-${String(i + 1).padStart(3, '0')}`,
    host: `${rng.int(10, 250)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
    port: rng.pick([8080, 9000, 1080, 3128]),
    provider: rng.pick(['Bright Data', 'Smartproxy', 'IPRoyal', 'Oxylabs']),
    countryCode: rng.pick(['US', 'GB', 'DE', 'NL', 'CA']),
    costCents: rng.int(60, 420),
    active: rng.chance(0.9),
    createdAt: daysAgo(rng.int(60, 200)),
  }))
  await prisma.proxy.createMany({ data: proxies })

  // --- subreddits ---------------------------------------------------------
  console.log('· subreddits')
  const subreddits = SUBREDDITS.map((s) => ({
    id: id(),
    name: s.name,
    subscribers: s.subscribers,
    isNsfw: true,
    verificationRequired: s.verificationRequired,
    minKarma: s.minKarma,
    minAccountAgeDays: s.minAccountAgeDays,
    postCooldownHours: s.postCooldownHours,
    allowedFlairs: s.flairs,
    rulesSummary: s.rules,
    tier: s.tier,
    tierIsManual: s.tier === 'S',
    status: s.status,
    lastScrapedAt: daysAgo(rng.int(0, 6)),
    createdAt: daysAgo(rng.int(120, 200)),
  }))
  await prisma.subreddit.createMany({ data: subreddits })
  const postableSubs = subreddits.filter((s) => s.status !== 'BANNED_FOR_US')

  // per-subreddit behaviour the whole simulation reads from
  const subProfile = new Map(
    subreddits.map((s) => {
      const reach = Math.log10(Math.max(1000, s.subscribers)) - 3 // 0 .. ~2.4
      return [
        s.id,
        {
          reach,
          // how likely a post here is removed by mods
          removalRate:
            s.status === 'RISKY' ? rng.gauss(0.28, 0.06, 0.12, 0.45) : rng.gauss(0.07, 0.035, 0.01, 0.2),
          // landings per upvote — the "CTR proxy"
          ctr: s.tier === 'S' ? rng.gauss(0.16, 0.04, 0.05, 0.3) : s.tier === 'A' ? rng.gauss(0.12, 0.035, 0.04, 0.25) : rng.gauss(0.07, 0.03, 0.02, 0.18),
          // how well its traffic converts once it lands
          convRate: s.tier === 'S' ? rng.gauss(0.05, 0.015, 0.01, 0.1) : s.tier === 'A' ? rng.gauss(0.038, 0.012, 0.008, 0.08) : rng.gauss(0.022, 0.01, 0.004, 0.06),
        },
      ]
    }),
  )

  // --- reddit accounts ----------------------------------------------------
  // Two cohorts, because they exist for different reasons:
  //   imported — predate the CRM, warmed, and carry almost all of the posts
  //   farmed   — created inside the tracked window by a named farmer, which is
  //              what the ranking and daily counters measure
  console.log('· accounts + creation attempts')

  type AccountRow = {
    id: string
    username: string
    passwordEnc: string
    emailAddress: string
    emailProvider: string
    emailVerified: boolean
    phoneVerified: boolean
    createdById: string | null
    createdAt: Date
    redditCreatedAt: Date
    karmaPost: number
    karmaComment: number
    proxyId: string
    status: 'WARMING' | 'READY' | 'ACTIVE' | 'SHADOWBANNED' | 'SUSPENDED' | 'RETIRED'
    assignedCreatorId: string | null
    assignedPosterId: string | null
    lastCheckedAt: Date
    shadowbanned: boolean
    suspendedAt: Date | null
    verifiedSubreddits: string[]
    healthScore: number
    notes: string | null
    pollTier: 'HOT' | 'WARM' | 'COLD' | 'DORMANT'
    lastPolledAt: Date
    nextPollAt: Date
    lastPostAt: Date | null
    suspectedMissedPosts: number
  }

  const accounts: AccountRow[] = []
  const attempts: Array<Record<string, unknown>> = []
  const usernames = new Set<string>()

  function newUsername() {
    let u = redditUsername(rng)
    while (usernames.has(u)) u = redditUsername(rng)
    usernames.add(u)
    return u
  }

  function makeAccount(opts: {
    bornDaysAgo: number
    createdById: string | null
    ageDaysAtNow: number
  }): AccountRow {
    const username = newUsername()
    const proxy = rng.pick(proxies)
    const provider = rng.pick(EMAIL_PROVIDERS)
    const bornAt = daysAgo(opts.bornDaysAgo, rng.int(0, 86_399_000))
    // karma accrues roughly with age, with a lot of spread
    const karmaPost = Math.max(0, Math.round(rng.gauss(opts.ageDaysAtNow * 3.2, opts.ageDaysAtNow * 1.6, 0, 40_000)))
    const karmaComment = Math.max(0, Math.round(rng.gauss(opts.ageDaysAtNow * 1.4, opts.ageDaysAtNow * 0.9, 0, 20_000)))
    return {
      id: id(),
      username,
      passwordEnc: encryptSecret(`Rd-${rng.int(100000, 999999)}-${rng.pick(['xq', 'zt', 'mv', 'pk'])}`),
      emailAddress: `${username}@${provider}`,
      emailProvider: provider,
      emailVerified: rng.chance(0.92),
      phoneVerified: rng.chance(0.55),
      createdById: opts.createdById,
      createdAt: bornAt,
      redditCreatedAt: bornAt,
      karmaPost,
      karmaComment,
      proxyId: proxy.id,
      status: 'WARMING',
      assignedCreatorId: null,
      assignedPosterId: null,
      lastCheckedAt: daysAgo(rng.int(0, 2), rng.int(0, 86_399_000)),
      shadowbanned: false,
      suspendedAt: null,
      verifiedSubreddits: [],
      healthScore: 50,
      notes: null,
      pollTier: 'DORMANT',
      lastPolledAt: daysAgo(0, -rng.int(0, 6 * 3_600_000)),
      nextPollAt: addHours(new Date(), rng.int(1, 24)),
      lastPostAt: null,
      suspectedMissedPosts: 0,
    }
  }

  // imported cohort: old enough to have posted through the whole 90 days
  for (let i = 0; i < N.importedAccounts; i++) {
    const bornDaysAgo = rng.int(N.historyDays + 20, 340)
    accounts.push(makeAccount({ bornDaysAgo, createdById: null, ageDaysAtNow: bornDaysAgo }))
  }

  // farmed cohort: one attempt row per try, successes also create an account
  for (let d = N.creationWindowDays - 1; d >= 0; d--) {
    const key = dayKey(daysAgo(d), BOUNDARY_TZ)
    const batchDate = dayDateColumn(key)
    // spread attempts across the actual workspace day, never past "now"
    const { start: dayStart } = dayBounds(key, BOUNDARY_TZ)
    const dayEndMs = Math.min(Date.now(), dayStart.getTime() + 86_400_000)
    const weekend = [0, 6].includes(dayStart.getUTCDay())

    for (const farmer of farmers) {
      // attainment wanders per farmer per day; weekends are thinner
      const base = farmer.dailyAccountGoal * rng.gauss(0.62, 0.18, 0.15, 1.15) * (weekend ? 0.55 : 1)
      const tries = Math.max(0, Math.round(base * rng.gauss(1.55, 0.2, 1.1, 2.2)))
      // Dmitri's proxy pool is worse, so his failure mix is worse — this is the
      // kind of thing the ranking screen is supposed to make visible
      const failBias = farmer.name.startsWith('Dmitri') ? 1.5 : 1

      for (let t = 0; t < tries; t++) {
        const outcome = rng.weighted([
          ['SUCCESS', 62],
          ['FAILED_CREATE', 18 * failBias],
          ['FAILED_VERIFY', 12 * failBias],
          ['FAILED_CAPTCHA', 8 * failBias],
        ] as const)
        const proxy = rng.pick(proxies)
        const at = clampPast(new Date(dayStart.getTime() + rng.next() * (dayEndMs - dayStart.getTime())))
        const costCents = rng.int(18, 65)

        if (outcome === 'SUCCESS') {
          const acct = makeAccount({ bornDaysAgo: d, createdById: farmer.id, ageDaysAtNow: d })
          acct.proxyId = proxy.id
          acct.createdAt = at
          acct.redditCreatedAt = at
          accounts.push(acct)
          attempts.push({
            id: id(), farmerId: farmer.id, batchDate, outcome, redditAccountId: acct.id,
            failureReason: null, proxyId: proxy.id, costCents, refundedCents: 0, createdAt: at,
          })
        } else {
          const reason =
            outcome === 'FAILED_CREATE' ? rng.pick(['Username taken', 'Reddit rejected the signup form', 'Proxy flagged at signup'])
            : outcome === 'FAILED_VERIFY' ? rng.pick(['Email verification link never arrived', 'SMS code rejected', 'Phone number already used'])
            : rng.pick(['hCaptcha loop', 'Captcha timed out after 3 attempts'])
          // a failed attempt that never consumed a number sometimes gets refunded
          const refunded = outcome === 'FAILED_CAPTCHA' && rng.chance(0.4) ? costCents : 0
          attempts.push({
            id: id(), farmerId: farmer.id, batchDate, outcome, redditAccountId: null,
            failureReason: reason, proxyId: proxy.id, costCents, refundedCents: refunded, createdAt: at,
          })
        }
      }
    }
  }

  console.log(`  ${accounts.length} accounts, ${attempts.length} creation attempts`)

  // --- lifecycle: warm-up, verification, burn -----------------------------
  // Burn is what makes "accounts made" a volume metric and "7d survival" the
  // quality one, so it is modelled explicitly rather than sprinkled randomly.
  const now = new Date()
  const subsByTier = {
    S: postableSubs.filter((s) => s.tier === 'S'),
    A: postableSubs.filter((s) => s.tier === 'A'),
    B: postableSubs.filter((s) => s.tier === 'B'),
    C: postableSubs.filter((s) => s.tier === 'C'),
  }

  for (const a of accounts) {
    const ageDays = (now.getTime() - a.redditCreatedAt.getTime()) / 86_400_000
    const farmed = a.createdById !== null
    // farmers differ in quality: a per-farmer survival multiplier drives the
    // 7d survival column and separates a good farmer from a fast one
    const farmerQuality = farmed
      ? { 'Chinedu Eze': 1.15, 'Ngozi Balogun': 1.2, 'Kwame Mensah': 0.95, 'Rina Salvador': 1.05, 'Dmitri Volkov': 0.62, 'Amara Nwosu': 1.1 }[
          users.find((u) => u.id === a.createdById)!.name
        ] ?? 1
      : 1

    const burnP = Math.min(0.6, (farmed ? 0.2 : 0.1) / farmerQuality)
    if (ageDays > 2 && rng.chance(burnP)) {
      // Most burns land in the first fortnight — which is exactly why 7d is the
      // cut — but an account can be caught at any point in its life, and if
      // every burn happened on day four the survival column would read 100%
      // for anyone working aged inventory.
      const burnAtDays = rng.chance(0.6)
        ? Math.min(ageDays, Math.abs(rng.gauss(4, 4, 0.5, 14)))
        : Math.min(ageDays, 14 + rng.next() * Math.max(1, ageDays - 14))
      a.suspendedAt = new Date(a.redditCreatedAt.getTime() + burnAtDays * 86_400_000)
      a.status = 'SUSPENDED'
      a.healthScore = 0
      a.pollTier = 'DORMANT'
      a.notes = rng.pick(['Suspended for ban evasion after 2 removals', 'Site-wide suspension, no appeal', 'Suspended following a subreddit report'])
      continue
    }

    if (rng.chance(0.045)) {
      a.shadowbanned = true
      a.status = 'SHADOWBANNED'
      a.healthScore = rng.int(5, 22)
      a.pollTier = 'COLD'
      a.notes = 'Own posts visible logged-in, absent from /new — shadowban confirmed by health job.'
      continue
    }

    if (rng.chance(0.05) && ageDays > 30) {
      a.status = 'RETIRED'
      a.healthScore = rng.int(10, 35)
      a.pollTier = 'DORMANT'
      a.notes = 'Retired — karma stalled and removal rate above 40%.'
      continue
    }

    // verification is earned, not given: karma + age gates
    const verified: string[] = []
    for (const s of [...subsByTier.S, ...subsByTier.A]) {
      if (a.karmaPost >= s.minKarma && ageDays >= s.minAccountAgeDays && rng.chance(0.35)) {
        verified.push(s.name)
      }
    }
    a.verifiedSubreddits = verified

    const readyForPosting = ageDays >= 21 && a.karmaPost >= 50
    a.status = readyForPosting ? (rng.chance(0.82) ? 'ACTIVE' : 'READY') : 'WARMING'
    // capped contributions on purpose: a 300-day-old account with 40k karma is
    // not twice as healthy as a 120-day-old one, and letting the score pin at
    // 100 for half the inventory makes the column useless for triage
    a.healthScore = Math.round(
      rng.gauss(
        22 + Math.min(24, ageDays / 8) + Math.min(20, a.karmaPost / 90) + Math.min(10, verified.length * 1.5),
        11,
        5,
        99,
      ),
    )
  }

  await chunked(accounts, 1000, (batch) => prisma.redditAccount.createMany({ data: batch }))
  await chunked(attempts, 2000, (batch) =>
    prisma.accountCreationAttempt.createMany({ data: batch as never }),
  )

  // --- tracked links: one per account, issued at creation, never reassigned
  console.log('· tracked links')
  const trackedLinks = accounts.map((a) => {
    const slug = `${slugify(a.username).slice(0, 14)}${rng.int(100, 999)}`
    return {
      id: id(),
      slug,
      redditAccountId: a.id,
      // the join key that carries account identity all the way into OF revenue
      ofTrackingLinkId: `oft_${slug}`,
      funnelUrl: `${FUNNEL_BASE}/${slug}`,
      issuedAt: a.createdAt,
      retiredAt: a.status === 'RETIRED' ? daysAgo(rng.int(1, 20)) : null,
      status: a.status === 'RETIRED' ? ('RETIRED' as const) : ('ACTIVE' as const),
    }
  })
  await chunked(trackedLinks, 2000, (batch) => prisma.trackedLink.createMany({ data: batch }))
  const linkByAccount = new Map(trackedLinks.map((l) => [l.redditAccountId, l]))

  // --- assignment history -------------------------------------------------
  // Accounts get reassigned. The whole point of this table is that a post keeps
  // the creator/poster it was made for, so we generate real spans here.
  console.log('· assignment history')
  const activeCreators = creators.filter((c) => c.status !== 'CHURNED')
  const assignments: Array<{
    id: string
    redditAccountId: string
    creatorId: string
    posterId: string
    startedAt: Date
    endedAt: Date | null
  }> = []

  const assignable = accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'READY' || a.status === 'SUSPENDED' || a.status === 'SHADOWBANNED')
  for (const a of assignable) {
    const ageDays = (now.getTime() - a.redditCreatedAt.getTime()) / 86_400_000
    if (ageDays < 21) continue // still warming when it was born
    // custody starts once warmed, ~21 days after creation
    let cursor = new Date(a.redditCreatedAt.getTime() + 21 * 86_400_000)
    const end = a.suspendedAt ?? now
    const spans = rng.weighted([[1, 70], [2, 22], [3, 8]] as const)

    for (let s = 0; s < spans && cursor < end; s++) {
      const creator = rng.pick(activeCreators)
      // only a poster actually allowed to work that creator
      const eligible = posters
      const poster = rng.pick(eligible)
      const spanDays = s === spans - 1 ? Infinity : rng.int(14, 45)
      const spanEnd = spanDays === Infinity ? null : new Date(Math.min(end.getTime(), cursor.getTime() + spanDays * 86_400_000))
      assignments.push({
        id: id(),
        redditAccountId: a.id,
        creatorId: creator.id,
        posterId: poster.id,
        startedAt: cursor,
        endedAt: spanEnd && spanEnd < end ? spanEnd : a.suspendedAt,
      })
      if (!spanEnd) break
      cursor = spanEnd
    }
  }
  await chunked(assignments, 2000, (batch) => prisma.accountAssignment.createMany({ data: batch }))

  // reflect the *current* holder onto the account row for the inventory screen
  const currentAssignment = new Map<string, { creatorId: string; posterId: string }>()
  for (const asg of assignments) {
    if (asg.endedAt === null || asg.endedAt > now) {
      currentAssignment.set(asg.redditAccountId, { creatorId: asg.creatorId, posterId: asg.posterId })
    }
  }
  await chunked([...currentAssignment.entries()], 500, async (batch) => {
    await prisma.$transaction(
      batch.map(([accountId, cur]) =>
        prisma.redditAccount.update({
          where: { id: accountId },
          data: { assignedCreatorId: cur.creatorId, assignedPosterId: cur.posterId },
        }),
      ),
    )
  })
  console.log(`  ${assignments.length} assignment spans, ${currentAssignment.size} live`)

  // --- posts --------------------------------------------------------------
  // Every Post row in this product is created by the scraper, so the seed
  // pretends to be the scraper: it picks what a VA plausibly did, then records
  // postedAt (Reddit's) and firstSeenAt (ours) separately. The gap between
  // them is the discovery lag the Scraper page monitors.
  console.log('· posts')

  const byPoster = new Map<string, typeof assignments>()
  for (const asg of assignments) {
    const list = byPoster.get(asg.posterId) ?? []
    list.push(asg)
    byPoster.set(asg.posterId, list)
  }

  function heldAt(posterId: string, at: Date) {
    const list = byPoster.get(posterId) ?? []
    return list.filter((a) => a.startedAt <= at && (a.endedAt === null || a.endedAt > at))
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const subById = new Map(subreddits.map((s) => [s.id, s]))
  /** last time an account posted to a subreddit — drives the cooldown matrix */
  const cooldown = new Map<string, Date>()

  type PostRow = {
    id: string
    redditPostId: string
    redditAccountId: string
    subredditId: string
    creatorId: string | null
    posterId: string | null
    title: string
    flair: string | null
    mediaType: 'IMAGE' | 'VIDEO' | 'GALLERY' | 'LINK' | 'TEXT'
    url: string
    postedAt: Date
    firstSeenAt: Date
    status: 'LIVE' | 'REMOVED' | 'DELETED' | 'SHADOWBANNED'
    attributionStatus: 'RESOLVED' | 'NEEDS_REVIEW'
    removedAt: Date | null
    removalReason: string | null
    lastMetricAt: Date | null
    latestUpvotes: number
    latestComments: number
    latestUpvoteRatio: number
    /** simulation-only, not persisted */
    _peak: number
    _tau: number
  }

  const postRows: PostRow[] = []

  // Audience-driven, not VA-driven: posting time follows the US evening, which
  // is why posters in Lagos and Manila post at hours that look odd locally.
  const HOUR_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
    [0, 7], [1, 6], [2, 4], [3, 2], [4, 1], [5, 1], [6, 1], [7, 2],
    [8, 2], [9, 3], [10, 3], [11, 4], [12, 5], [13, 6], [14, 8], [15, 9],
    [16, 10], [17, 11], [18, 12], [19, 12], [20, 11], [21, 10], [22, 9], [23, 8],
  ]

  for (let d = N.historyDays - 1; d >= 0; d--) {
    const dayStart = daysAgo(d)
    dayStart.setUTCHours(0, 0, 0, 0)
    const weekend = [0, 6].includes(dayStart.getUTCDay())

    for (const poster of posters) {
      // per-poster attainment drift plus a weekly rhythm
      const attain = rng.gauss(0.82, 0.16, 0.25, 1.15) * (weekend ? 0.8 : 1)
      const count = Math.max(0, Math.round(poster.dailyPostGoal * attain))
      const held = heldAt(poster.id, dayStart)
      if (!held.length) continue

      for (let i = 0; i < count; i++) {
        const asg = rng.pick(held)
        const account = accountById.get(asg.redditAccountId)!
        if (account.suspendedAt && account.suspendedAt < dayStart) continue

        const hour = rng.weighted(HOUR_WEIGHTS)
        const postedAt = new Date(dayStart.getTime() + hour * 3_600_000 + rng.int(0, 59) * 60_000)
        if (postedAt > now) continue

        // a subreddit this account is actually allowed into, and off cooldown
        const ageDays = (postedAt.getTime() - account.redditCreatedAt.getTime()) / 86_400_000
        const eligible = postableSubs.filter((s) => {
          if (s.verificationRequired && !account.verifiedSubreddits.includes(s.name)) return false
          if (account.karmaPost < s.minKarma) return false
          if (ageDays < s.minAccountAgeDays) return false
          const last = cooldown.get(`${account.id}:${s.id}`)
          if (last && postedAt.getTime() - last.getTime() < s.postCooldownHours * 3_600_000) return false
          return true
        })
        if (!eligible.length) continue

        // posters lean on the tiers that pay, but still spread for cooldowns
        const sub = rng.weighted(
          eligible.map((s) => [s, s.tier === 'S' ? 5 : s.tier === 'A' ? 4 : s.tier === 'B' ? 2 : 1] as const),
        )
        cooldown.set(`${account.id}:${sub.id}`, postedAt)

        const profile = subProfile.get(sub.id)!
        // peak upvotes: subreddit reach × account standing × title luck
        const peak = Math.max(
          1,
          Math.round(
            Math.exp(rng.gauss(2.3 + profile.reach * 0.95 + Math.min(0.8, account.karmaPost / 5000), 0.85, 0, 8)),
          ),
        )

        const removed = rng.chance(profile.removalRate)
        const removedAfterMin = removed ? Math.abs(rng.gauss(140, 190, 3, 3000)) : 0

        // Discovery lag: hot-tier accounts are polled every 10 min, so most
        // posts surface fast. Cold accounts that suddenly post surface slowly —
        // and a post removed before we ever polled is simply never inserted.
        const wasHot = account.lastPostAt && postedAt.getTime() - account.lastPostAt.getTime() < 86_400_000
        const lagMin = wasHot ? rng.gauss(5.5, 3.2, 0.5, 22) : Math.abs(rng.gauss(48, 65, 2, 400))
        if (removed && removedAfterMin < lagMin) {
          // we never saw it — record the karma-move signal instead of a Post row
          account.suspectedMissedPosts += 1
          continue
        }

        account.lastPostAt = postedAt

        postRows.push({
          id: id(),
          redditPostId: `t3_${rng.int(1e8, 999999999).toString(36)}${rng.int(100, 999)}`,
          redditAccountId: account.id,
          subredditId: sub.id,
          creatorId: asg.creatorId,
          posterId: poster.id,
          title: rng.pick(TITLE_TEMPLATES),
          flair: sub.allowedFlairs.length ? rng.pick(sub.allowedFlairs) : null,
          mediaType: rng.weighted([['IMAGE', 62], ['VIDEO', 24], ['GALLERY', 11], ['LINK', 3]] as const),
          url: `https://reddit.com/r/${sub.name}/comments/${rng.int(1e6, 9999999).toString(36)}/`,
          postedAt,
          firstSeenAt: addMinutes(postedAt, Math.round(lagMin)),
          status: removed ? 'REMOVED' : 'LIVE',
          attributionStatus: 'RESOLVED',
          removedAt: removed ? addMinutes(postedAt, Math.round(removedAfterMin)) : null,
          removalReason: removed ? rng.pick(REMOVAL_REASONS) : null,
          lastMetricAt: null,
          latestUpvotes: 0,
          latestComments: 0,
          latestUpvoteRatio: 0,
          _peak: peak,
          _tau: rng.gauss(3.2, 1.1, 1, 8),
        })
      }
    }
  }

  // A handful of posts come from accounts nobody held at postedAt, or from
  // accounts not in the database at all. Those are exactly the rows that must
  // NOT be guessed at or dropped — they go to the manager review queue.
  const orphanCount = Math.round(postRows.length * 0.014)
  const unassignedAccounts = accounts.filter((a) => !currentAssignment.has(a.id) && a.status !== 'SUSPENDED')
  for (let i = 0; i < orphanCount && unassignedAccounts.length; i++) {
    const account = rng.pick(unassignedAccounts)
    const sub = rng.pick(postableSubs)
    const postedAt = daysAgo(rng.int(0, 21), rng.int(0, 86_399_000))
    const peak = Math.max(1, Math.round(Math.exp(rng.gauss(2.6, 0.9, 0, 8))))
    postRows.push({
      id: id(),
      redditPostId: `t3_${rng.int(1e8, 999999999).toString(36)}${rng.int(100, 999)}`,
      redditAccountId: account.id,
      subredditId: sub.id,
      creatorId: null,
      posterId: null,
      title: rng.pick(TITLE_TEMPLATES),
      flair: null,
      mediaType: 'IMAGE',
      url: `https://reddit.com/r/${sub.name}/comments/${rng.int(1e6, 9999999).toString(36)}/`,
      postedAt,
      firstSeenAt: addMinutes(postedAt, rng.int(4, 120)),
      status: 'LIVE',
      attributionStatus: 'NEEDS_REVIEW',
      removedAt: null,
      removalReason: null,
      lastMetricAt: null,
      latestUpvotes: 0,
      latestComments: 0,
      latestUpvoteRatio: 0,
      _peak: peak,
      _tau: rng.gauss(3.2, 1.1, 1, 8),
    })
  }

  console.log(`  ${postRows.length} posts (${postRows.filter((p) => p.attributionStatus === 'NEEDS_REVIEW').length} need attribution)`)

  // --- metric snapshots ---------------------------------------------------
  // Append-only, on the same cadence the real job uses: dense while the post is
  // young, then thinning out. A removed post gets one final collapse snapshot
  // so the curve shows it dying rather than just stopping.
  console.log('· metric snapshots')

  const FULL_LADDER_H = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 36, 48, 72, 120, 168]
  const THIN_LADDER_H = [0.25, 1, 3, 6, 12, 24, 48, 120, 168]

  // Built in memory first: PostMetric rows carry a foreign key to Post, so the
  // posts have to exist before any snapshot can be written.
  const metricRows: Array<Record<string, unknown>> = []

  for (const p of postRows) {
    const ageH = (now.getTime() - p.postedAt.getTime()) / 3_600_000
    const ladder = ageH < 24 * 7 ? FULL_LADDER_H : THIN_LADDER_H
    const removedAtH = p.removedAt ? (p.removedAt.getTime() - p.postedAt.getTime()) / 3_600_000 : Infinity

    let last: { upvotes: number; comments: number; ratio: number; at: Date } | null = null

    for (const h of ladder) {
      if (h > ageH) break
      if (h > removedAtH) break
      const upvotes = Math.max(1, Math.round(p._peak * (1 - Math.exp(-h / p._tau)) * rng.gauss(1, 0.05, 0.8, 1.2)))
      const ratio = Math.min(0.99, Math.max(0.5, rng.gauss(0.93 - Math.min(0.2, h / 200), 0.04, 0.5, 0.99)))
      const comments = Math.round(upvotes * rng.gauss(0.055, 0.03, 0.005, 0.2))
      const at = addHours(p.postedAt, h)
      metricRows.push({
        id: id(), postId: p.id, capturedAt: at, upvotes, upvoteRatio: Number(ratio.toFixed(3)),
        comments, rank: h <= 6 ? rng.int(1, 120) : null,
        estimatedViews: Math.round(upvotes * rng.gauss(38, 12, 12, 90)),
      })
      last = { upvotes, comments, ratio, at }
    }

    if (p.removedAt && p.removedAt <= now && last) {
      // score collapses to 1 while the comments stay — the removal signature
      metricRows.push({
        id: id(), postId: p.id, capturedAt: addMinutes(p.removedAt, 9), upvotes: 1,
        upvoteRatio: 0.5, comments: last.comments, rank: null, estimatedViews: null,
      })
      p.latestUpvotes = 1
      p.latestComments = last.comments
      p.latestUpvoteRatio = 0.5
      p.lastMetricAt = addMinutes(p.removedAt, 9)
      // keep the peak for landing attribution — traffic happened before removal
      p._peak = last.upvotes
    } else if (last) {
      p.latestUpvotes = last.upvotes
      p.latestComments = last.comments
      p.latestUpvoteRatio = Number(last.ratio.toFixed(3))
      p.lastMetricAt = last.at
      p._peak = last.upvotes
    } else {
      p._peak = 0
    }
  }
  await chunked(postRows, 2000, (batch) =>
    prisma.post.createMany({
      data: batch.map(({ _peak, _tau, ...rest }) => {
        void _peak
        void _tau
        return rest
      }),
    }),
  )
  await chunked(metricRows, 5000, (batch) => prisma.postMetric.createMany({ data: batch as never }))
  console.log(`  ${metricRows.length} metric snapshots`)

  // --- funnel events + conversions ----------------------------------------
  // A landing exists only behind a post that actually got upvotes, and a
  // conversion exists only behind an outbound click. Traffic is never invented
  // out of nowhere, because half the product's job is telling you when it dried
  // up on purpose.
  console.log('· funnel events + conversions')

  const postsByAccount = new Map<string, PostRow[]>()
  for (const p of postRows) {
    const list = postsByAccount.get(p.redditAccountId) ?? []
    list.push(p)
    postsByAccount.set(p.redditAccountId, list)
  }
  for (const list of postsByAccount.values()) list.sort((a, b) => +a.postedAt - +b.postedAt)

  let funnelRows: Array<Record<string, unknown>> = []
  let conversionRows: Array<Record<string, unknown>> = []
  let landingCount = 0
  let conversionCount = 0
  let extId = 0

  async function flushFunnel(force = false) {
    if (funnelRows.length >= 5000 || (force && funnelRows.length)) {
      await prisma.funnelEvent.createMany({ data: funnelRows as never })
      funnelRows = []
    }
    if (conversionRows.length >= 2000 || (force && conversionRows.length)) {
      await prisma.conversion.createMany({ data: conversionRows as never })
      conversionRows = []
    }
  }

  // a few accounts have a broken bio link: live posts, zero landings. The Deep
  // Links page is supposed to catch exactly this as silent revenue loss.
  const brokenLinkAccounts = new Set(
    rng.shuffle([...postsByAccount.keys()]).slice(0, Math.max(3, Math.round(postsByAccount.size * 0.02))),
  )

  for (const p of postRows) {
    if (p._peak <= 0) continue
    if (brokenLinkAccounts.has(p.redditAccountId)) continue
    const link = linkByAccount.get(p.redditAccountId)
    if (!link) continue
    const profile = subProfile.get(p.subredditId)!

    const landings = Math.round(p._peak * profile.ctr * rng.gauss(1, 0.35, 0.2, 2.2))
    if (landings <= 0) continue

    const siblings = (postsByAccount.get(p.redditAccountId) ?? []).filter(
      (o) => o.id !== p.id && Math.abs(+o.postedAt - +p.postedAt) < 3 * 3_600_000,
    )
    const attributionType = siblings.length ? ('INFERRED' as const) : ('EXACT' as const)
    // split proportionally by upvote velocity when several posts were live
    const totalPeak = p._peak + siblings.reduce((s, o) => s + o._peak, 0)
    const weight = siblings.length ? Number((p._peak / Math.max(1, totalPeak)).toFixed(3)) : 1

    for (let i = 0; i < landings; i++) {
      // traffic decays fast after the post peaks
      const hOffset = Math.abs(rng.gauss(2.5, 5.5, 0.02, 96))
      const ts = addHours(p.postedAt, hOffset)
      if (ts > now) continue
      const isBot = rng.chance(0.075)
      // ~18% of landings are a repeat visit inside the same session window, so
      // unique landings are genuinely lower than raw landings. The reused seed
      // has to be the SAME string as an earlier landing's, not merely derived
      // from it, or every "repeat" hashes to its own fresh session.
      const sessionSeed =
        i > 0 && rng.chance(0.18) ? `${p.id}:${Math.floor(rng.next() * i)}` : `${p.id}:${i}`
      const session = privacyHash(sessionSeed, 'sess')
      const ip = privacyHash(`${rng.int(0, 1e9)}`, 'ip')
      const country = rng.weighted(COUNTRIES.map((c, idx) => [c, idx < 3 ? 30 : 8] as const))

      funnelRows.push({
        id: id(), trackedLinkId: link.id, type: 'LANDED', attributedPostId: p.id,
        attributionType, attributionWeight: weight, ts, sessionHash: session, ipHash: ip,
        countryCode: country, deviceType: rng.pick(DEVICES),
        userAgentHash: privacyHash(`${country}:${rng.int(0, 999)}`, 'ua'),
        isBot, referrer: rng.pick(['https://www.reddit.com/', 'https://out.reddit.com/', 'android-app://com.reddit.frontpage', null]),
      })
      landingCount++

      // funnel pass — the one stage we fully control
      if (isBot || !rng.chance(0.63)) {
        await flushFunnel()
        continue
      }
      const outboundTs = clampPast(addMinutes(ts, rng.int(1, 240) / 10))
      funnelRows.push({
        id: id(), trackedLinkId: link.id, type: 'OUTBOUND', attributedPostId: p.id,
        attributionType, attributionWeight: weight, ts: outboundTs, sessionHash: session,
        ipHash: ip, countryCode: country, deviceType: 'mobile',
        userAgentHash: privacyHash(`${country}:out`, 'ua'), isBot: false, referrer: link.funnelUrl,
      })

      if (rng.chance(profile.convRate)) {
        const type = rng.weighted([
          ['FREE_SUB', 46], ['TRIAL', 22], ['PAID_SUB', 18], ['PPV', 10], ['TIP', 4],
        ] as const)
        const amountCents =
          type === 'FREE_SUB' ? 0
          : type === 'TRIAL' ? rng.pick([0, 0, 199, 299])
          : type === 'PAID_SUB' ? rng.pick([699, 899, 999, 1299, 1499])
          : type === 'PPV' ? rng.int(400, 4500)
          : rng.int(200, 12000)
        const creatorId = p.creatorId ?? accountById.get(p.redditAccountId)?.assignedCreatorId ?? creators[0].id
        conversionRows.push({
          id: id(), ofTrackingLinkId: link.ofTrackingLinkId, trackedLinkId: link.id,
          creatorId, type, amountCents,
          occurredAt: addHours(outboundTs, Math.abs(rng.gauss(6, 14, 0.05, 168))),
          externalId: `of_${++extId}_${link.slug}`, syncedAt: addHours(outboundTs, 24),
        })
        conversionCount++
      }
      await flushFunnel()
    }
  }
  await flushFunnel(true)
  console.log(`  ${landingCount} landings, ${conversionCount} conversions`)

  // --- farming sessions ---------------------------------------------------
  console.log('· farming sessions')
  const warmable = accounts.filter((a) => a.status === 'WARMING' || a.status === 'READY' || a.status === 'ACTIVE')
  const sessions: Array<Record<string, unknown>> = []
  for (let d = 44; d >= 0; d--) {
    for (const farmer of farmers) {
      const count = rng.int(0, 6)
      for (let i = 0; i < count; i++) {
        const account = rng.pick(warmable)
        const startedAt = daysAgo(d, rng.int(6, 22) * 3_600_000)
        if (startedAt < account.redditCreatedAt || startedAt > now) continue
        const durationMin = Math.round(rng.gauss(26, 12, 6, 90))
        const karmaBefore = rng.int(0, Math.max(1, account.karmaComment))
        sessions.push({
          id: id(), farmerId: farmer.id, redditAccountId: account.id, startedAt,
          endedAt: addMinutes(startedAt, durationMin), durationMin,
          commentsMade: rng.int(2, 22), postsMade: rng.chance(0.3) ? rng.int(1, 3) : 0,
          karmaBefore, karmaAfter: karmaBefore + rng.int(0, 40),
          subredditsTouched: rng.shuffle(postableSubs).slice(0, rng.int(1, 4)).map((s) => s.name),
          notes: rng.chance(0.12) ? rng.pick(['Comment auto-removed twice, sub may be filtering new accounts', 'Karma stalled, moving to a lower-friction sub', 'Account looks healthy, ready for verification']) : null,
          createdAt: startedAt,
        })
      }
    }
  }
  await chunked(sessions, 2000, (batch) => prisma.farmingSession.createMany({ data: batch as never }))

  // --- account health snapshots (last 30 days) ----------------------------
  console.log('· health snapshots')
  const healthRows: Array<Record<string, unknown>> = []
  const tracked = rng.shuffle(accounts).slice(0, Math.min(accounts.length, 900))
  for (const a of tracked) {
    for (let d = 29; d >= 0; d -= 1) {
      const at = daysAgo(d, 3 * 3_600_000)
      if (at < a.redditCreatedAt) continue
      const decay = d / 30
      healthRows.push({
        id: id(), redditAccountId: a.id, capturedAt: at,
        karmaPost: Math.max(0, Math.round(a.karmaPost * (1 - decay * 0.25))),
        karmaComment: Math.max(0, Math.round(a.karmaComment * (1 - decay * 0.25))),
        shadowbanned: a.shadowbanned && d < 6,
        suspended: !!(a.suspendedAt && a.suspendedAt <= at),
        healthScore: Math.max(0, Math.round(a.healthScore * (1 - decay * 0.15))),
      })
    }
  }
  await chunked(healthRows, 5000, (batch) => prisma.accountHealthSnapshot.createMany({ data: batch as never }))

  // --- poll tiers, derived from what actually got posted ------------------
  const hot: string[] = [], warm: string[] = [], cold: string[] = [], dormant: string[] = []
  for (const a of accounts) {
    if (a.status === 'SUSPENDED' || a.status === 'RETIRED') { dormant.push(a.id); continue }
    const since = a.lastPostAt ? (now.getTime() - a.lastPostAt.getTime()) / 86_400_000 : Infinity
    if (since <= 1) hot.push(a.id)
    else if (since <= 7) warm.push(a.id)
    else if (currentAssignment.has(a.id)) cold.push(a.id)
    else dormant.push(a.id)
  }
  const tierIntervalH = { HOT: 1 / 6, WARM: 1, COLD: 6, DORMANT: 24 }
  for (const [tier, ids] of [['HOT', hot], ['WARM', warm], ['COLD', cold], ['DORMANT', dormant]] as const) {
    await chunked(ids, 2000, (batch) =>
      prisma.redditAccount.updateMany({
        where: { id: { in: batch } },
        data: { pollTier: tier, nextPollAt: addHours(now, tierIntervalH[tier] * (0.3 + rng.next())) },
      }),
    )
  }
  // write back lastPostAt + the suspected-missed-post counter
  await chunked(
    accounts.filter((a) => a.lastPostAt || a.suspectedMissedPosts),
    400,
    async (batch) => {
      await prisma.$transaction(
        batch.map((a) =>
          prisma.redditAccount.update({
            where: { id: a.id },
            data: { lastPostAt: a.lastPostAt, suspectedMissedPosts: a.suspectedMissedPosts },
          }),
        ),
      )
    },
  )
  console.log(`  poll tiers — hot ${hot.length} · warm ${warm.length} · cold ${cold.length} · dormant ${dormant.length}`)

  // --- follower snapshots -------------------------------------------------
  const followerRows: Array<Record<string, unknown>> = []
  for (const c of creators) {
    let count = rng.int(1800, 26_000)
    for (let d = N.historyDays; d >= 0; d--) {
      count += Math.round(rng.gauss(c.status === 'PAUSED' ? -8 : 34, 40, -200, 400))
      followerRows.push({ id: id(), creatorId: c.id, ts: daysAgo(d, 2 * 3_600_000), followerCount: Math.max(0, count), source: 'OF_API' })
    }
  }
  await prisma.followerSnapshot.createMany({ data: followerRows as never })

  // --- scraper config + job history ---------------------------------------
  console.log('· scraper')
  await prisma.scraperConfig.createMany({
    data: [
      { id: id(), type: 'POST_DISCOVERY', intervalSec: 300, rateLimitPerMin: 55, maxAttempts: 4, hotIntervalSec: 600, warmIntervalSec: 3600, coldIntervalSec: 21600, dormantIntervalSec: 86400 },
      { id: id(), type: 'POST_METRICS', intervalSec: 300, rateLimitPerMin: 90, maxAttempts: 3 },
      { id: id(), type: 'REMOVAL_DETECTION', intervalSec: 900, rateLimitPerMin: 60, maxAttempts: 3 },
      { id: id(), type: 'ACCOUNT_HEALTH', intervalSec: 86_400, rateLimitPerMin: 30, maxAttempts: 2 },
      { id: id(), type: 'SUBREDDIT_RULES', intervalSec: 604_800, rateLimitPerMin: 20, maxAttempts: 2 },
      { id: id(), type: 'OF_CONVERSION_SYNC', intervalSec: 3600, rateLimitPerMin: 30, maxAttempts: 5 },
    ],
  })

  const jobRows: Array<Record<string, unknown>> = []
  const jobTypes = ['POST_DISCOVERY', 'POST_METRICS', 'REMOVAL_DETECTION', 'ACCOUNT_HEALTH', 'SUBREDDIT_RULES', 'OF_CONVERSION_SYNC'] as const
  for (const type of jobTypes) {
    const runs = type === 'POST_DISCOVERY' ? 260 : type === 'POST_METRICS' ? 200 : type === 'REMOVAL_DETECTION' ? 80 : 20
    for (let i = 0; i < runs; i++) {
      const startedAt = daysAgo(0, -(i * (type === 'ACCOUNT_HEALTH' ? 86_400_000 : 900_000) + rng.int(0, 200_000)))
      // intermittent breakage, so the failure timeline has something to show
      const failed = rng.chance(type === 'OF_CONVERSION_SYNC' ? 0.09 : 0.035)
      const errors = failed ? rng.int(1, 14) : rng.chance(0.2) ? rng.int(1, 3) : 0
      jobRows.push({
        id: id(), type, target: null,
        status: failed ? (rng.chance(0.15) ? 'DEAD_LETTER' : 'FAILED') : 'SUCCESS',
        startedAt, finishedAt: addMinutes(startedAt, rng.int(1, 9) / 10),
        itemsProcessed: failed ? rng.int(0, 40) : rng.int(20, 480), errorsCount: errors,
        lastError: failed ? rng.pick(['429 Too Many Requests — backing off 60s', 'ECONNRESET reading account timeline', 'OF API returned 502 on /transactions', 'Proxy pool exhausted, all endpoints in cooldown']) : null,
      })
    }
  }
  await chunked(jobRows, 2000, (batch) => prisma.scraperJob.createMany({ data: batch as never }))

  // --- audit log + notifications ------------------------------------------
  console.log('· audit + notifications')
  const auditRows: Array<Record<string, unknown>> = []
  for (let i = 0; i < 380; i++) {
    const actor = rng.pick([...managers, ...posters, ...farmers])
    const action = rng.weighted([
      ['credential.reveal', 14], ['account.reassign', 22], ['account.retire', 8],
      ['user.role_change', 3], ['subreddit.tier_change', 10], ['post.attribution_resolve', 18],
      ['account.create', 20], ['report.generate', 5],
    ] as const)
    const account = rng.pick(accounts)
    auditRows.push({
      id: id(), actorId: actor.id, action,
      entityType: action.startsWith('account') || action === 'credential.reveal' ? 'RedditAccount' : action.startsWith('subreddit') ? 'Subreddit' : action.startsWith('user') ? 'User' : 'Post',
      entityId: account.id,
      before: action === 'account.reassign' ? { assignedPosterId: rng.pick(posters).id } : null,
      after: action === 'account.reassign' ? { assignedPosterId: rng.pick(posters).id } : null,
      ip: `${rng.int(10, 250)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
      ts: daysAgo(rng.int(0, 45), rng.int(0, 86_399_000)),
    })
  }
  await prisma.auditLog.createMany({ data: auditRows as never })

  const recentRemovals = postRows.filter((p) => p.removedAt && p.removedAt > daysAgo(2)).slice(0, 60)
  const notifRows: Array<Record<string, unknown>> = recentRemovals
    .filter((p) => p.posterId)
    .map((p) => ({
      id: id(), userId: p.posterId!, severity: 'WARN',
      title: `Post removed in r/${subById.get(p.subredditId)!.name}`,
      body: p.removalReason, href: `/posting`, entityType: 'Post', entityId: p.id,
      readAt: rng.chance(0.5) ? p.removedAt : null, createdAt: p.removedAt!,
    }))
  for (const m of managers) {
    notifRows.push({
      id: id(), userId: m.id, severity: 'CRITICAL',
      title: `${postRows.filter((p) => p.attributionStatus === 'NEEDS_REVIEW').length} posts need attribution`,
      body: 'Discovered from accounts with no assignment at postedAt.',
      href: '/posting/attribution', entityType: 'Post', entityId: null,
      readAt: null, createdAt: daysAgo(0, -2 * 3_600_000),
    })
  }
  await prisma.notification.createMany({ data: notifRows as never })

  // --- one example report ------------------------------------------------
  // Marked model = "seed-fixture" and headed as such wherever it is displayed,
  // so nobody mistakes a hand-written placeholder for something the model
  // actually concluded. Real reports need ANTHROPIC_API_KEY.
  console.log('· example report')
  const { buildReportContext, periodFor } = await import('../src/lib/reports/context')
  const reportPeriod = periodFor('daily_ops', BOUNDARY_TZ)
  const reportContext = await buildReportContext('GLOBAL', null, reportPeriod)
  const t = reportContext.totals
  const money = (cents: number | null) => (cents == null ? 'n/a' : `$${(cents / 100).toFixed(2)}`)
  const pct = (r: number | null) => (r == null ? 'n/a' : `${(r * 100).toFixed(1)}%`)

  await prisma.report.create({
    data: {
      scope: 'GLOBAL',
      scopeId: null,
      kind: 'daily_ops',
      periodStart: reportPeriod.start,
      periodEnd: reportPeriod.end,
      headline: `SEED FIXTURE — ${t.posts ?? 0} posts yesterday at a ${pct(t.removalRate)} removal rate, ${money(t.revenueCents)} attributed.`,
      summaryMd: [
        '**This report was written by the seed script, not by a model.** It exists so the report screen has something to render before `ANTHROPIC_API_KEY` is configured. Every figure below is read straight from the stored context object, so the traceability panel is genuine even though the prose is not.',
        `Yesterday produced ${t.posts ?? 0} discovered posts across ${t.accountsUsed ?? 0} accounts, of which ${t.removed ?? 0} were removed — a ${pct(t.removalRate)} removal rate. Those posts drew ${t.landings ?? 0} landings against ${t.upvotes ?? 0} upvotes, a ${pct(t.ctrProxy)} click rate; that ratio is a proxy for reach, not an impression count, because Reddit does not expose impressions.`,
        `${t.outbound ?? 0} of those landings clicked through, a funnel pass rate of ${pct(t.funnelPassRate)}. ${t.conversions ?? 0} conversions followed, worth ${money(t.revenueCents)}, or ${money(t.revenuePerPostCents)} per post.`,
        `Data quality caveat: median discovery lag was ${reportContext.dataQuality.medianDiscoveryLagMin ?? 'n/a'} minutes and ${reportContext.dataQuality.postsNeedingAttribution} posts are still unattributed, so the per-VA figures understate whoever those posts belong to.`,
      ].join('\n\n'),
      findingsJson: {
        findings: [
          {
            title: 'Removal rate on the day',
            detail: `${t.removed ?? 0} of ${t.posts ?? 0} posts were pulled by moderators.`,
            severity: (t.removalRate ?? 0) > 0.12 ? 'warn' : 'info',
            metric: 'removalRate',
            value: t.removalRate ?? 0,
            change_pct: reportContext.change.removalRate ?? 0,
          },
          {
            title: 'Posts with no attribution',
            detail:
              'Discovered on accounts nobody held at postedAt. They count for no VA and no creator until a manager resolves them, so today\'s per-VA numbers are a floor, not a total.',
            severity: reportContext.dataQuality.postsNeedingAttribution > 0 ? 'warn' : 'info',
            metric: 'dataQuality.postsNeedingAttribution',
            value: reportContext.dataQuality.postsNeedingAttribution,
            change_pct: 0,
          },
          {
            title: 'Accounts posting with no landings',
            detail:
              'Live posts in the last 48 hours and not a single landing behind them. Either the bio link is broken or the account is shadowbanned; both leak revenue silently.',
            severity:
              reportContext.dataQuality.accountsWithLivePostsNoLandings > 5 ? 'critical' : 'info',
            metric: 'dataQuality.accountsWithLivePostsNoLandings',
            value: reportContext.dataQuality.accountsWithLivePostsNoLandings,
            change_pct: 0,
          },
        ],
        recommendations: [
          {
            action: `Clear the ${reportContext.dataQuality.postsNeedingAttribution}-post attribution queue before the weekly review runs`,
            rationale:
              'Unattributed posts silently depress whoever actually made them, and the weekly VA review reads from the same numbers.',
            expected_impact: 'Per-VA output figures become complete rather than a floor.',
            effort: 'low',
            owner_role: 'MANAGER',
          },
          {
            action: 'Check the bio link on every account flagged with live posts and zero landings',
            rationale:
              'An account that posts and receives no traffic is either mis-linked or shadowbanned. Both are invisible without this check.',
            expected_impact: 'Recovers traffic already being paid for in posting time.',
            effort: 'med',
            owner_role: 'POSTER',
          },
        ],
        questions_for_humans: [
          'Was there a known moderator action yesterday that would explain the removal pattern, or is this drift?',
          'Are the accounts with no landings ones we expect to be shadowbanned already?',
        ],
      },
      contextJson: reportContext as unknown as object,
      generatedById: managers[0]?.id ?? null,
      model: 'seed-fixture',
      version: 1,
    },
  })

  console.log(`\n  workspace: ${workspace.name} · day boundary ${workspace.dayBoundaryTimezone}`)
  console.log('  sign in with any seeded email, password: password123')
  console.log(`  admin: ${STAFF[0].email}   manager: ${STAFF[1].email}`)
  console.timeEnd('seed')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
