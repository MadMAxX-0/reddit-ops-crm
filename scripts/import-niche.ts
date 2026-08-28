/**
 * Import a hand-researched subreddit list into a niche.
 *
 *   npm run niche:import -- --file scripts/lists/trans.tsv --niche "Trans" --color "#C084FC"
 *
 * The file is TSV and the columns are found by shape, not by position, because
 * every export puts them somewhere different. Column 0 is the name; the
 * subscriber count is the first column that parses as one; an audience column
 * is any that says NSFW or SFW; the note is whatever is left. `r/` prefixes are
 * optional and `2.1M` / `6.8k` / `6,800` all read as numbers.
 *
 * Two rules govern what this writes:
 *
 *  1. A note is evidence of a rule, never of its absence. "verification" sets
 *     `requiresVerification` true; a row that says nothing about verification
 *     leaves the field null, because null means NOT READ. Silence is never
 *     written as `false` — that is the difference between "this sub allows it"
 *     and "nobody has checked", and confusing the two is how accounts get banned.
 *  2. Rules read from Reddit itself outrank a pasted note. If the enricher has
 *     already set a field, this leaves it alone.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** "6.8k" | "6,800" | "6800" -> 6800 */
function subscribers(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '').toLowerCase()
  if (!s) return null
  const m = /^([\d.]+)(k|m)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return Math.round(n * (m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1))
}

/**
 * What a note asserts. Only ever returns `true` — see rule 1 above. Selling and
 * promo rules are deliberately not read: near every NSFW sub bans promo in some
 * form, so the flag would be true everywhere and sort nothing.
 */
function claims(note: string) {
  const n = note.toLowerCase()
  const out: {
    requiresVerification?: true
    originalContentOnly?: true
    bansAskingForUpvotes?: true
    minKarma?: number
    minAccountAgeDays?: number
  } = {}
  if (/\bverif/.test(n)) out.requiresVerification = true
  if (/\b(no reposts?|original content|\boc\b|no fakes)/.test(n)) out.originalContentOnly = true
  if (/(upvote|clickbait|click bait|karma.?bait|engagement.?bait|vote.?beg|abusive title)/.test(n))
    out.bansAskingForUpvotes = true

  // Only a stated number counts. "karma/age req" says a gate exists but not
  // where it sits, and a gate of unknown height is not a number — it stays null
  // and the note carries the warning until the real rules are read.
  const karma =
    /(?:min(?:imum)?\s*|karma requirement of\s*)(\d[\d,]*)\s*(?:\+\s*)?karma|karma requirement of\s*(\d[\d,]*)/.exec(
      n,
    )
  if (karma) {
    const v = Number((karma[1] ?? karma[2]).replace(/,/g, ''))
    if (Number.isFinite(v) && v > 0) out.minKarma = v
  }
  const age = /(?:active for|account (?:must be )?(?:at least )?)(\d+)\s*days?/.exec(n)
  if (age) {
    const v = Number(age[1])
    if (Number.isFinite(v) && v > 0) out.minAccountAgeDays = v
  }
  return out
}

/** Rows whose note is a placeholder carry no information to record. */
const EMPTY_NOTE = /^\+?\s*note$/i

async function main() {
  const file = arg('--file')
  const nicheName = arg('--niche')
  const color = arg('--color') ?? null
  if (!file || !nicheName) {
    console.error('usage: --file <tsv> --niche <name> [--color #RRGGBB]')
    process.exit(1)
  }

  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split('\t').map((c) => c.trim())
      const name = cols[0].replace(/^\/?r\//i, '')
      const rest = cols.slice(1)
      const subs = rest.map(subscribers).find((v) => v !== null) ?? null
      const audience = rest.find((c) => /^(nsfw|sfw)\b/i.test(c)) ?? null
      // The note is the last column that is neither the count nor the audience.
      const note =
        [...rest].reverse().find((c) => c && c !== audience && subscribers(c) === null) ?? null
      return {
        name,
        subs,
        // "NSFW / SFW ok" means the sub is 18+ but takes clothed posts too —
        // worth keeping, because it is where a teaser can go.
        note:
          [
            audience && /sfw ok/i.test(audience) ? 'SFW posts allowed' : null,
            note && !EMPTY_NOTE.test(note) ? note : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      }
    })
    // Rows the source could not capture carry no subreddit to file.
    .filter((r) => /^[A-Za-z0-9_]{2,21}$/.test(r.name))

  const niche = await prisma.subredditNiche.upsert({
    where: { name: nicheName },
    update: { color: color ?? undefined },
    create: { name: nicheName, color },
  })

  let created = 0
  let updated = 0
  let flagged = 0

  for (const row of rows) {
    const existing = await prisma.discoveredSubreddit.findUnique({
      where: { name: row.name },
      select: {
        id: true,
        requiresVerification: true,
        originalContentOnly: true,
        bansAskingForUpvotes: true,
        rulesCheckedAt: true,
      },
    })

    const asserted = row.note ? claims(row.note) : {}

    // Only fill fields still null. A field the enricher has read from the
    // subreddit's own rules is the better answer and stays.
    const fill: Record<string, true> = {}
    for (const [k, v] of Object.entries(asserted)) {
      if (!existing || existing[k as keyof typeof existing] === null) fill[k] = v as true
    }
    if (Object.keys(fill).length) flagged++

    await prisma.discoveredSubreddit.upsert({
      where: { name: row.name },
      update: {
        // A pasted count is a placeholder for a real reading, never a
        // replacement for one. The first import of this list was out by up to
        // 6x against Reddit's own numbers, so once the enricher has read a
        // subreddit the pasted figure is not allowed near it.
        ...(row.subs === null || existing?.rulesCheckedAt ? {} : { subscribers: row.subs }),
        over18: true,
        promoted: true,
        ...fill,
      },
      create: {
        name: row.name,
        subscribers: row.subs,
        over18: true,
        // Hand-researched, not turned up by the crawler: it arrives already in
        // the working list rather than waiting in the discovery queue.
        promoted: true,
        ...fill,
      },
    })
    existing ? updated++ : created++

    await prisma.subredditNicheItem.upsert({
      where: { nicheId_subreddit: { nicheId: niche.id, subreddit: row.name } },
      update: { note: row.note },
      create: { nicheId: niche.id, subreddit: row.name, note: row.note },
    })
  }

  const total = await prisma.subredditNicheItem.count({ where: { nicheId: niche.id } })
  const unread = await prisma.discoveredSubreddit.count({
    where: { nicheItems: { some: { nicheId: niche.id } }, rulesCheckedAt: null },
  })

  console.log(`niche "${niche.name}" -> ${total} subreddits`)
  console.log(`  ${created} new, ${updated} already known, ${flagged} gained a requirement flag`)
  console.log(`  ${unread} have never had their real rules read — run the enricher`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
