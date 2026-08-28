'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'
import { runSubredditDiscovery } from '@/lib/jobs/subreddit-discovery'
import { enrichSubreddits } from '@/lib/jobs/subreddit-enrich'

/**
 * The scraper watches other people's accounts to learn where to post.
 *
 * Everything here is a read of public timelines. Nothing is written to Reddit,
 * and a discovered subreddit never joins the working list on its own — that is
 * always someone pressing a button.
 */

const usernames = z.string().min(1).max(4000)

/** Accepts a paste: newlines, commas or spaces, with or without `u/`. */
export async function addTargets(raw: string, note?: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const parsed = usernames.safeParse(raw)
  if (!parsed.success) return { ok: false as const, error: 'Nothing to add.' }

  const names = [
    ...new Set(
      parsed.data
        .split(/[\s,]+/)
        .map((s) =>
          s
            .trim()
            .replace(/^\/?(u\/|user\/)/i, '')
            .replace(/\/$/, ''),
        )
        .filter((s) => /^[A-Za-z0-9_-]{3,20}$/.test(s)),
    ),
  ]
  if (!names.length) return { ok: false as const, error: 'No valid usernames found.' }

  await prisma.scrapeTarget.createMany({
    data: names.map((username) => ({ username, note: note || null, addedById: ctx.user.id })),
    skipDuplicates: true,
  })

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.SCRAPER_CONFIG,
    entityType: 'ScrapeTarget',
    after: { added: names },
  })

  revalidatePath('/admin/scraper')
  return { ok: true as const, count: names.length }
}

export async function removeTarget(id: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.scrapeTarget.delete({ where: { id } })
  revalidatePath('/admin/scraper')
  return { ok: true as const }
}

export async function toggleTarget(id: string, active: boolean) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.scrapeTarget.update({ where: { id }, data: { active } })
  revalidatePath('/admin/scraper')
  return { ok: true as const }
}

/** Reads every active target's timeline now, rather than waiting for the timer. */
export async function scrapeNow() {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.SCRAPER_RUN,
    entityType: 'ScrapeTarget',
    after: { manual: true },
  })

  const result = await runSubredditDiscovery()
  revalidatePath('/admin/scraper')
  return { ok: true as const, detail: result }
}

/** Moves a discovered subreddit into the working list. */
export async function promoteSubreddit(names: string[]) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const parsed = z.array(z.string().min(1)).min(1).max(200).safeParse(names)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }

  const found = await prisma.discoveredSubreddit.findMany({
    where: { name: { in: parsed.data } },
    select: { name: true, subscribers: true, over18: true },
  })

  for (const d of found) {
    await prisma.subreddit.upsert({
      where: { name: d.name },
      create: { name: d.name, subscribers: d.subscribers ?? 0, isNsfw: d.over18 },
      update: {},
    })
  }
  await prisma.discoveredSubreddit.updateMany({
    where: { name: { in: parsed.data } },
    data: { promoted: true },
  })

  await writeAudit({
    actorId: ctx.user.id,
    action: AUDIT_ACTIONS.SUBREDDIT_TIER,
    entityType: 'Subreddit',
    after: { promotedFromDiscovery: parsed.data },
  })

  revalidatePath('/admin/scraper')
  revalidatePath('/admin/subreddits')
  return { ok: true as const, count: found.length }
}

export async function dismissSubreddit(names: string[], dismissed = true) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.discoveredSubreddit.updateMany({
    where: { name: { in: names } },
    data: { dismissed },
  })
  revalidatePath('/admin/scraper')
  return { ok: true as const }
}

/** Reads the rules of subreddits we have not read, or read a fortnight ago. */
export async function enrichNow(names?: string[]) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const result = await enrichSubreddits(names?.length ? { names } : { limit: 30 })
  revalidatePath('/admin/scraper')
  return { ok: true as const, detail: result }
}

/* --------------------------------------------------------------- niches --
 * A niche is the audience a subreddit serves, which is what decides whether a
 * model belongs in it. This is the point of the scraper: discovery finds
 * candidates, the rules say which are usable, and a niche is what a VA is
 * actually handed.
 */

const nicheName = z.string().trim().min(1).max(60)

export async function createNiche(name: string, color?: string, note?: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const parsed = nicheName.safeParse(name)
  if (!parsed.success) return { ok: false as const, error: 'Give the niche a name.' }

  const existing = await prisma.subredditNiche.findUnique({ where: { name: parsed.data } })
  if (existing) return { ok: false as const, error: `"${parsed.data}" already exists.` }

  const niche = await prisma.subredditNiche.create({
    data: {
      name: parsed.data,
      color: color || null,
      note: note?.trim() || null,
      createdById: ctx.user.id,
    },
  })
  revalidatePath('/admin/scraper')
  return { ok: true as const, id: niche.id }
}

export async function deleteNiche(id: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.subredditNiche.delete({ where: { id } })
  revalidatePath('/admin/scraper')
  return { ok: true as const }
}

/** Files subreddits under a niche. Already-there ones are skipped, not an error. */
export async function addToNiche(nicheId: string, names: string[]) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const parsed = z.array(z.string().min(1)).min(1).max(500).safeParse(names)
  if (!parsed.success) return { ok: false as const, error: 'Nothing selected.' }

  const result = await prisma.subredditNicheItem.createMany({
    data: parsed.data.map((subreddit) => ({ nicheId, subreddit })),
    skipDuplicates: true,
  })
  revalidatePath('/admin/scraper')
  return { ok: true as const, count: result.count }
}

export async function removeFromNiche(nicheId: string, subreddit: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.subredditNicheItem.deleteMany({ where: { nicheId, subreddit } })
  revalidatePath('/admin/scraper')
  return { ok: true as const }
}
