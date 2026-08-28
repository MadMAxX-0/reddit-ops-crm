'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCtx } from '@/lib/session'
import { runSpy } from '@/lib/jobs/spy'
import { cleanTags } from '@/lib/spy-tags'

/**
 * Everything here reads public timelines. Nothing is written to Reddit and no
 * account is contacted — this is the same information anyone gets by opening
 * the profile, collected so it can be compared over time.
 */
export async function addTargets(raw: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }

  const names = [
    ...new Set(
      raw
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
    data: names.map((username) => ({ username, addedById: ctx.user.id })),
    skipDuplicates: true,
  })
  revalidatePath('/spy')
  return { ok: true as const, count: names.length }
}

export async function removeTarget(id: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.scrapeTarget.delete({ where: { id } })
  revalidatePath('/spy')
  return { ok: true as const }
}

export async function toggleTarget(id: string, active: boolean) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  await prisma.scrapeTarget.update({ where: { id }, data: { active } })
  revalidatePath('/spy')
  return { ok: true as const }
}

/**
 * Reddit throttles the feed, so this is slow by design — a handful of accounts
 * takes a minute. It is a button rather than a schedule because watching is
 * something a person decides to do.
 */
export async function refreshSpy(username?: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const res = await runSpy(username ? { usernames: [username] } : {})
  revalidatePath('/spy')
  return { ok: true as const, ...res }
}

/** A dot per album, so an album is recognisable before its name is read. */
const PALETTE = ['#FF7A3D', '#4D8DFF', '#2ECC71', '#A78BFA', '#F5A623', '#22D3EE', '#F472B6']

export async function createAlbum(name: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const clean = name.trim().slice(0, 60)
  if (!clean) return { ok: false as const, error: 'Give it a name.' }
  const existing = await prisma.spyAlbum.findUnique({ where: { name: clean } })
  if (existing) return { ok: false as const, error: 'That album already exists.' }
  const count = await prisma.spyAlbum.count()
  await prisma.spyAlbum.create({
    data: { name: clean, color: PALETTE[count % PALETTE.length], createdById: ctx.user.id },
  })
  revalidatePath('/spy')
  return { ok: true as const }
}

export async function deleteAlbum(id: string) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  // Deleting an album never deletes the accounts in it — the album is a way of
  // looking at them, not the reason they are watched.
  await prisma.spyAlbum.delete({ where: { id } })
  revalidatePath('/spy')
  return { ok: true as const }
}

/**
 * Tags describe the ACCOUNT — niche, language, why we bother watching it.
 * Albums describe posts. Keeping them apart is the point: "Latina creators" is
 * a fact about a person, "this title worked" is a fact about a post, and one
 * list cannot hold both without becoming useless.
 */
export async function setTags(targetId: string, tags: string[]) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  const clean = cleanTags(tags)
  await prisma.scrapeTarget.update({ where: { id: targetId }, data: { tags: clean } })
  revalidatePath('/spy')
  return { ok: true as const }
}

/** Keep a post: the title, the subreddit, the hour — the thing worth copying. */
export async function saveToAlbum(postId: string, albumId: string, saved: boolean) {
  const ctx = await requireCtx()
  if (!ctx.isManager) return { ok: false as const, error: 'Managers only.' }
  if (saved) {
    await prisma.spyAlbumPost.upsert({
      where: { albumId_postId: { albumId, postId } },
      update: {},
      create: { albumId, postId },
    })
  } else {
    await prisma.spyAlbumPost.deleteMany({ where: { albumId, postId } })
  }
  revalidatePath('/spy')
  return { ok: true as const }
}
