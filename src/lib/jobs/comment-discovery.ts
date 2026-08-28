import { prisma } from '@/lib/prisma'
import { ROTATION_ACCOUNT } from '@/lib/queries/rotation'

/**
 * Walk each account's comment history.
 *
 * Posting is only half of what these accounts do, and for some of them it is
 * none of it: four of the thirteen in rotation have zero live posts and between
 * five and nineteen recent comments each. Farming is done in comments, and the
 * karma gate on the largest subreddit on our lists — r/FemBoys, 2.7M — is
 * specifically *comment* karma. An operation that cannot see comments cannot
 * see whether an account is being worked or whether it can post anywhere yet.
 *
 * Read straight from the host rather than through the provider interface: this
 * is the only caller, and `getCommentsByUsername` returns Reddit's raw comment
 * object, which no existing snapshot type describes.
 */
interface RawComment {
  name?: string
  id?: string
  subreddit?: string
  body?: string
  score?: number
  created_utc?: number
  link_title?: string
  permalink?: string
}

const HOST = 'reddit34.p.rapidapi.com'

async function fetchComments(
  username: string,
  cursor?: string,
): Promise<{
  items: RawComment[]
  cursor: string | null
}> {
  const qs = new URLSearchParams({ username, sort: 'new' })
  if (cursor) qs.set('cursor', cursor)
  const res = await fetch(`https://${HOST}/getCommentsByUsername?${qs}`, {
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY ?? '',
      'x-rapidapi-host': HOST,
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const json = (await res.json()) as {
    success?: boolean
    data?: { cursor?: string | null; posts?: Array<{ data?: RawComment }> | null }
  }
  if (!json.success) return { items: [], cursor: null }
  const items = (json.data?.posts ?? []).map((p) => p.data ?? {}).filter((d) => d.name)
  return { items, cursor: json.data?.cursor ?? null }
}

export async function runCommentDiscovery(opts: { usernames?: string[]; maxPages?: number } = {}) {
  const accounts = await prisma.redditAccount.findMany({
    where: opts.usernames?.length
      ? {
          OR: opts.usernames.map((u) => ({
            username: { equals: u, mode: 'insensitive' as const },
          })),
        }
      : ROTATION_ACCOUNT,
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  })

  const maxPages = opts.maxPages ?? 4
  let inserted = 0
  let seen = 0
  const failures: string[] = []

  for (const account of accounts) {
    try {
      let cursor: string | undefined
      for (let page = 0; page < maxPages; page++) {
        const { items, cursor: next } = await fetchComments(account.username, cursor)
        if (!items.length) break
        seen += items.length

        for (const c of items) {
          const redditCommentId = c.name!
          // createMany + skipDuplicates rather than upsert: a comment's body and
          // subreddit never change, and its score is not worth a write per poll.
          const created = await prisma.redditComment.createMany({
            data: [
              {
                redditAccountId: account.id,
                redditCommentId,
                subreddit: c.subreddit ?? 'unknown',
                linkTitle: c.link_title?.slice(0, 300) ?? null,
                permalink: c.permalink ?? null,
                body: c.body?.slice(0, 500) ?? null,
                score: c.score ?? 0,
                postedAt: new Date((c.created_utc ?? 0) * 1000),
                lastMetricAt: new Date(),
              },
            ],
            skipDuplicates: true,
          })
          inserted += created.count
        }

        if (!next) break
        cursor = next
      }
    } catch (err) {
      failures.push(`${account.username}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { accounts: accounts.length, seen, inserted, failures }
}
