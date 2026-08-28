/**
 * Read-only connectivity check for the configured Reddit provider.
 *   npx tsx scripts/reddit-check.ts [username] [subreddit]
 *
 * Exercises all five provider methods against real, public accounts and writes
 * nothing to the database. Run this before pointing the scraper at a new
 * provider — a provider that authenticates but returns the wrong shape looks
 * exactly like an inventory full of dead accounts.
 */
import 'dotenv/config'
import { redditProvider, RapidApiRedditProvider } from '../src/lib/reddit'

const username = process.argv[2] ?? 'spez'
const subreddit = process.argv[3] ?? 'news'

function ok(label: string, detail: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${label.padEnd(24)} ${detail}`)
}
function bad(label: string, detail: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${label.padEnd(24)} ${detail}`)
}

async function main() {
  const provider = redditProvider()
  console.log(`\nprovider: ${provider.name}\n`)

  let failures = 0
  const step = async (label: string, fn: () => Promise<string>) => {
    try {
      ok(label, await fn())
    } catch (err) {
      failures++
      bad(label, err instanceof Error ? err.message : String(err))
    }
  }

  await step('getAccount', async () => {
    const a = await provider.getAccount(username)
    if (!a.exists) throw new Error(`u/${username} reported as not existing`)
    return `u/${a.username} · ${a.karmaPost} post karma · created ${a.createdAt?.toISOString().slice(0, 10)}`
  })

  let firstPostId: string | null = null
  await step('listAccountSubmissions', async () => {
    const posts = await provider.listAccountSubmissions(username)
    if (!posts.length) throw new Error('returned no posts')
    firstPostId = posts[0].redditPostId
    const lag = posts[0].postedAt.toISOString().slice(0, 10)
    return `${posts.length} posts · newest ${posts[0].redditPostId} in r/${posts[0].subreddit} (${lag})`
  })

  await step('getPost', async () => {
    if (!firstPostId) throw new Error('skipped — no post id from the previous step')
    const p = await provider.getPost(firstPostId)
    if (p.missing) throw new Error(`${firstPostId} not returned`)
    return `${p.redditPostId} · ${p.upvotes} upvotes · ratio ${p.upvoteRatio} · ${p.comments} comments`
  })

  await step('getSubreddit', async () => {
    const s = await provider.getSubreddit(subreddit)
    if (!s.exists) throw new Error(`r/${subreddit} reported as not existing`)
    return `r/${s.name} · ${s.subscribers.toLocaleString()} subs · nsfw=${s.isNsfw}`
  })

  await step('listSubredditNew', async () => {
    if (!provider.listSubredditNew) return 'not implemented by this provider'
    const posts = await provider.listSubredditNew(subreddit, 25)
    if (!posts.length) throw new Error('returned no posts')
    return `${posts.length} posts from r/${subreddit}`
  })

  // A username that certainly does not exist. It must come back as not-existing
  // rather than throwing, or the health job cannot tell dead from broken.
  await step('unknown account', async () => {
    const a = await provider.getAccount('zz_not_a_real_account_00998877')
    return a.exists ? 'WARNING: reported as existing' : 'correctly reported as not existing'
  })

  if (provider instanceof RapidApiRedditProvider) {
    const q = provider.quota()
    if (q.limit != null) {
      const used = q.limit - (q.remaining ?? 0)
      const days = q.resetAt ? Math.round((q.resetAt.getTime() - Date.now()) / 86_400_000) : null
      console.log(
        `\nquota: ${(q.remaining ?? 0).toLocaleString()} of ${q.limit.toLocaleString()} left ` +
          `(${used.toLocaleString()} used)${days != null ? `, resets in ~${days}d` : ''}`,
      )
      const perDay = days && days > 0 ? Math.floor((q.remaining ?? 0) / days) : null
      if (perDay) console.log(`       ≈ ${perDay.toLocaleString()} requests/day until reset`)
    }
  }

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
