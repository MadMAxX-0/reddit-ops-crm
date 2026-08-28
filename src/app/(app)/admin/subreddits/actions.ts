'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireManager } from '@/lib/session'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'

const TIERS = ['S', 'A', 'B', 'C'] as const
const STATUSES = ['ACTIVE', 'RISKY', 'BANNED_FOR_US'] as const

export async function setTier(subredditId: string, tier: (typeof TIERS)[number]) {
  const ctx = await requireManager()
  if (!TIERS.includes(tier)) return { ok: false as const, error: 'Unknown tier.' }

  const before = await prisma.subreddit.findUnique({
    where: { id: subredditId },
    select: { name: true, tier: true, tierIsManual: true },
  })
  if (!before) return { ok: false as const, error: 'Subreddit not found.' }

  await prisma.subreddit.update({
    where: { id: subredditId },
    // a hand-set tier sticks: the auto-suggestion proposes, it never overrides
    data: { tier, tierIsManual: true },
  })
  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.SUBREDDIT_TIER,
    entityType: 'Subreddit',
    entityId: subredditId,
    before,
    after: { name: before.name, tier, tierIsManual: true },
  })
  revalidatePath('/admin/subreddits')
  return { ok: true as const }
}

export async function setStatus(subredditId: string, status: (typeof STATUSES)[number]) {
  const ctx = await requireManager()
  if (!STATUSES.includes(status)) return { ok: false as const, error: 'Unknown status.' }
  const before = await prisma.subreddit.findUnique({
    where: { id: subredditId },
    select: { name: true, status: true },
  })
  await prisma.subreddit.update({ where: { id: subredditId }, data: { status } })
  await writeAudit({
    actorId: ctx.user.id,
    action: 'subreddit.status_change',
    entityType: 'Subreddit',
    entityId: subredditId,
    before,
    after: { status },
  })
  revalidatePath('/admin/subreddits')
  return { ok: true as const }
}

/** Accept the auto-suggestion for every subreddit whose tier is not hand-set. */
export async function applySuggestions(suggestions: Array<{ id: string; tier: string }>) {
  const ctx = await requireManager()
  const parsed = z
    .array(z.object({ id: z.string().min(1), tier: z.enum(TIERS) }))
    .max(500)
    .safeParse(suggestions)
  if (!parsed.success) return { ok: false as const, error: 'Invalid suggestions.' }

  let applied = 0
  for (const s of parsed.data) {
    const current = await prisma.subreddit.findUnique({
      where: { id: s.id },
      select: { tier: true, tierIsManual: true, name: true },
    })
    if (!current || current.tierIsManual || current.tier === s.tier) continue
    await prisma.subreddit.update({ where: { id: s.id }, data: { tier: s.tier } })
    applied += 1
  }

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.SUBREDDIT_TIER,
    entityType: 'Subreddit',
    after: { bulkSuggestionsApplied: applied },
  })
  revalidatePath('/admin/subreddits')
  return { ok: true as const, applied }
}

const importSchema = z.object({ csv: z.string().min(1).max(500_000) })

/**
 * CSV import. Upserts by name and only touches the playbook columns — never
 * performance, which is always derived from our own posts.
 */
export async function importSubreddits(input: z.input<typeof importSchema>) {
  const ctx = await requireManager()
  const parsed = importSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Nothing to import.' }

  const lines = parsed.data.csv
    .replace(/^﻿/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2)
    return { ok: false as const, error: 'Need a header row and at least one row.' }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const nameCol = idx('name')
  if (nameCol < 0) return { ok: false as const, error: 'CSV needs a "name" column.' }

  const errors: string[] = []
  let created = 0
  let updated = 0

  for (const [i, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line)
    const name = cells[nameCol]?.replace(/^r\//, '').trim()
    if (!name) {
      errors.push(`line ${i + 2}: missing name`)
      continue
    }
    const num = (col: string, fallback?: number) => {
      const c = idx(col)
      if (c < 0 || !cells[c]) return fallback
      const n = Number(cells[c])
      return Number.isFinite(n) ? n : fallback
    }
    const bool = (col: string) => {
      const c = idx(col)
      if (c < 0 || !cells[c]) return undefined
      return /^(1|true|yes|y)$/i.test(cells[c].trim())
    }
    const str = (col: string) => {
      const c = idx(col)
      return c >= 0 && cells[c] ? cells[c].trim() : undefined
    }

    const tier = str('tier')?.toUpperCase()
    const status = str('status')?.toUpperCase().replace(/\s+/g, '_')

    const data = {
      subscribers: num('subscribers'),
      isNsfw: bool('is_nsfw') ?? bool('nsfw'),
      verificationRequired: bool('verification_required'),
      minKarma: num('min_karma'),
      minAccountAgeDays: num('min_account_age_days'),
      postCooldownHours: num('post_cooldown_hours'),
      allowedFlairs: str('allowed_flairs')
        ?.split('|')
        .map((f) => f.trim())
        .filter(Boolean),
      rulesSummary: str('rules_summary'),
      tier: TIERS.includes(tier as never) ? (tier as (typeof TIERS)[number]) : undefined,
      tierIsManual: TIERS.includes(tier as never) ? true : undefined,
      status: STATUSES.includes(status as never)
        ? (status as (typeof STATUSES)[number])
        : undefined,
    }
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))

    const existing = await prisma.subreddit.findUnique({ where: { name }, select: { id: true } })
    if (existing) {
      await prisma.subreddit.update({ where: { id: existing.id }, data: clean })
      updated += 1
    } else {
      await prisma.subreddit.create({ data: { name, ...clean } })
      created += 1
    }
  }

  await writeAudit({
    actorId: ctx.user.id,
    action: 'subreddit.import',
    entityType: 'Subreddit',
    after: { created, updated, skipped: errors.length },
  })
  revalidatePath('/admin/subreddits')
  return { ok: true as const, created, updated, errors }
}

/** Minimal RFC-4180 splitter: enough for quoted commas in a rules summary. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
