import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'

/**
 * One tracked link per Reddit account, issued at account creation and never
 * reassigned. The account is the unit of attribution, so everything else
 * resolves downstream: account → creator/poster via AccountAssignment,
 * account → subreddits via discovered posts.
 */

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no l/o/0/1 — these get read aloud

function randomSlug(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
  const noise = Array.from(crypto.randomBytes(4))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('')
  return `${base}${noise}`
}

export async function issueTrackedLink(opts: {
  redditAccountId: string
  username: string
  funnelBaseUrl: string
  tx?: Pick<typeof prisma, 'trackedLink'>
}) {
  const db = opts.tx ?? prisma

  // slug collisions are astronomically unlikely but a duplicate would silently
  // merge two accounts' revenue, so we check rather than hope
  let slug = randomSlug(opts.username)
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.trackedLink.findUnique({ where: { slug }, select: { id: true } })
    if (!clash) break
    slug = randomSlug(opts.username)
  }

  return db.trackedLink.create({
    data: {
      slug,
      redditAccountId: opts.redditAccountId,
      // Minted one per Reddit account so OF's own attribution carries the
      // account identity all the way through to the subscription. This is the
      // join key between funnel data and OF revenue data.
      ofTrackingLinkId: `oft_${slug}`,
      funnelUrl: `${opts.funnelBaseUrl.replace(/\/$/, '')}/${slug}`,
      status: 'ACTIVE',
    },
  })
}
