/**
 * Prove the Reddit credentials work, before anything depends on them.
 *   npm run reddit:oauth:check
 */
import 'dotenv/config'
import { OAuthRedditProvider } from '../src/lib/reddit/oauth-provider'

async function main() {
  const missing = [
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_USERNAME',
    'REDDIT_PASSWORD',
  ].filter((k) => !process.env[k])
  if (missing.length) {
    console.error('not configured yet — missing:', missing.join(', '))
    console.error('\nCreate a "script" app at https://www.reddit.com/prefs/apps and put the')
    console.error('client id, secret, username and password in .env')
    process.exit(1)
  }

  const p = new OAuthRedditProvider({
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    username: process.env.REDDIT_USERNAME!,
    password: process.env.REDDIT_PASSWORD!,
    userAgent:
      process.env.REDDIT_USER_AGENT ??
      `macos:reddit-ops-crm:1.0 (by /u/${process.env.REDDIT_USERNAME})`,
  })

  const who = process.argv[2] ?? 'spez'
  const acct = await p.getAccount(who)
  console.log(`u/${who}: exists=${acct.exists} karma=${acct.karmaPost}/${acct.karmaComment}`)

  // Five consecutive reads. The whole reason this provider exists is that the
  // other one answers empty in streaks, so a single read proves nothing.
  for (let i = 1; i <= 5; i++) {
    const posts = await p.listAccountSubmissions(who, undefined, 1)
    console.log(
      `  read ${i}: ${posts.length} posts` +
        (posts.length
          ? ` · newest ${posts[0].postedAt.toISOString().slice(0, 16)} in r/${posts[0].subreddit}`
          : ''),
    )
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
