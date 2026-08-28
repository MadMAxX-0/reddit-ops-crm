import { OAuthRedditProvider } from './oauth-provider'
import { PublicRedditProvider } from './public-provider'
import { RapidApiRedditProvider } from './rapidapi-provider'
import { SimulatedRedditProvider } from './simulated-provider'
import type { RedditProvider } from './types'

export * from './types'

let cached: RedditProvider | null = null

/**
 * One interface, several implementations, selected by config. Nothing
 * downstream of this function knows which one it got.
 *
 *   REDDIT_PROVIDER=oauth      Reddit's own API (needs REDDIT_CLIENT_ID etc)
 *   REDDIT_PROVIDER=rapidapi   a RapidAPI Reddit host (needs RAPIDAPI_KEY)
 *   REDDIT_PROVIDER=public     reddit.com's own public JSON endpoints
 *   REDDIT_PROVIDER=simulated  (default in development) a local stand-in
 */
export function redditProvider(): RedditProvider {
  if (cached) return cached

  // Reddit's own API wins whenever it is configured, without anyone having to
  // set REDDIT_PROVIDER. The third-party host cannot be trusted to list posts —
  // it answers `success: true` with an empty array for accounts posting several
  // times a day, in streaks lasting tens of minutes — so the moment real
  // credentials exist they should be what runs.
  const oauthReady =
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME &&
    process.env.REDDIT_PASSWORD

  const choice =
    process.env.REDDIT_PROVIDER ??
    (oauthReady ? 'oauth' : process.env.NODE_ENV === 'production' ? 'public' : 'simulated')

  if (choice === 'oauth') {
    if (!oauthReady) {
      throw new Error(
        'REDDIT_PROVIDER=oauth but one of REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / ' +
          'REDDIT_USERNAME / REDDIT_PASSWORD is missing',
      )
    }
    cached = new OAuthRedditProvider({
      clientId: process.env.REDDIT_CLIENT_ID!,
      clientSecret: process.env.REDDIT_CLIENT_SECRET!,
      username: process.env.REDDIT_USERNAME!,
      password: process.env.REDDIT_PASSWORD!,
      userAgent:
        process.env.REDDIT_USER_AGENT ??
        `macos:reddit-ops-crm:1.0 (by /u/${process.env.REDDIT_USERNAME})`,
      ratePerMin: Number(process.env.REDDIT_RATE_PER_MIN ?? 90),
    })
    return cached
  }

  if (choice === 'rapidapi') {
    const apiKey = process.env.RAPIDAPI_KEY
    if (!apiKey) {
      throw new Error('REDDIT_PROVIDER=rapidapi but RAPIDAPI_KEY is not set')
    }
    cached = new RapidApiRedditProvider({
      apiKey,
      host: process.env.RAPIDAPI_REDDIT_HOST,
      ratePerMin: Number(process.env.REDDIT_RATE_PER_MIN ?? 60),
    })
  } else if (choice === 'public') {
    cached = new PublicRedditProvider({
      userAgent: process.env.REDDIT_USER_AGENT,
      ratePerMin: Number(process.env.REDDIT_RATE_PER_MIN ?? 55),
    })
  } else {
    cached = new SimulatedRedditProvider()
  }

  return cached
}

export { RapidApiRedditProvider, OAuthRedditProvider }

/** Tests and one-off scripts override the singleton through this. */
export function setRedditProvider(p: RedditProvider | null) {
  cached = p
}
