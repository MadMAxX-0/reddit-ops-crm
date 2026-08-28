/**
 * Bouncy links point at OnlyFans profiles, so the destination of a bio link is
 * the most reliable statement of which OF account a model actually uses.
 * This reads that mapping and applies it to the creators.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { onlyApi } from '../src/lib/onlyfans/theonlyapi'

const KEY = process.env.BOUNCY_KEY
const BASE = process.env.BOUNCY_BASE_URL ?? 'https://api.bouncy.ai'

async function bouncy(path: string) {
  const res = await fetch(BASE + path, {
    headers: { authorization: `Bearer ${KEY}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`bouncy ${res.status} on ${path}`)
  return res.json()
}

async function main() {
  if (!KEY) {
    console.error('BOUNCY_KEY not set')
    process.exit(1)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [links, groups] = await Promise.all([bouncy('/v1/links') as any, bouncy('/v1/groups') as any])
  const groupName = Object.fromEntries((groups.groups ?? []).map((g: any) => [g.id, g.name]))

  // model name → OF username, taken from what the bio links actually point at
  const ofByGuess = new Map<string, string>()
  for (const l of links.data ?? []) {
    const m = String(l.destination).match(/onlyfans\.com\/([^/?]+)/)
    if (m) ofByGuess.set(String(l.slug).toLowerCase(), m[1])
  }

  const creators = await prisma.creator.findMany({
    select: { id: true, stageName: true, ofUsername: true, ofUserId: true },
  })

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  let updated = 0

  for (const c of creators) {
    if (c.ofUserId) continue // already linked to a live OF account
    const key = norm(c.stageName)
    // find a bouncy link whose slug or destination carries this model's name
    let of: string | undefined
    for (const [slug, username] of ofByGuess) {
      if (norm(slug).includes(key) || norm(username).includes(key)) {
        of = username
        break
      }
    }
    if (!of || of === c.ofUsername) continue
    await prisma.creator.update({ where: { id: c.id }, data: { ofUsername: of } })
    console.log(`  ${c.stageName.padEnd(10)} → onlyfans.com/${of}`)
    updated++
  }

  // now try to link those to a connected TheOnlyAPI account by username
  const api = onlyApi()
  let linked = 0
  if (api) {
    const accounts = await api.listAccounts()
    const byUsername = new Map(accounts.filter((a) => a.username).map((a) => [a.username!.toLowerCase(), a]))
    for (const c of await prisma.creator.findMany({ where: { ofUserId: null } })) {
      const hit = byUsername.get((c.ofUsername ?? '').toLowerCase())
      if (!hit) continue
      await prisma.creator.update({ where: { id: c.id }, data: { ofUserId: hit.ofUserId } })
      console.log(`  linked ${c.stageName} to connected account ${hit.username} (${hit.ofUserId})`)
      linked++
    }
  }

  console.log(`\n${updated} OF usernames set, ${linked} newly connected to TheOnlyAPI\n`)

  console.log('=== Reddit-group bio links ===')
  for (const l of links.data ?? []) {
    if (groupName[l.groupId] !== 'Reddit') continue
    console.log(`  ${(l.url ?? l.slug).padEnd(42)} active=${l.isActive}  → ${l.destination}`)
  }

  const still = await prisma.creator.findMany({
    where: { ofUserId: null },
    select: { stageName: true, ofUsername: true },
  })
  if (still.length) {
    console.log('\nstill not connected to a live OF account:')
    for (const c of still) console.log(`  ${c.stageName.padEnd(10)} of=${c.ofUsername || '(unknown)'}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
