# Reddit Ops CRM — handover

Internal CRM for running Reddit marketing accounts. Next.js 16 (App Router,
Turbopack), React 19, Prisma 7 on PostgreSQL, NextAuth v5.

## Read this before deploying

**The scrapers cannot run on Vercel.** Reddit blocks datacenter IPs. Everything
that reads Reddit goes through `https://www.reddit.com/...rss`, which answers
`200` from a residential connection and is expected to fail from a cloud host.
That single dependency is why the whole data pipeline works — see
`src/lib/reddit/rss.ts` for why nothing else does.

Split the deployment:

| part | where |
|---|---|
| the web app | Vercel |
| PostgreSQL | any managed Postgres (Neon, Supabase, Vercel Postgres) |
| the scrapers | a machine with a residential IP, or a residential proxy |

The scrapers are plain `npm run` scripts against the same database, so a Mac
mini, a home server, or a proxied worker all work. They are already supervised
locally by a launchd agent (`~/Library/LaunchAgents/com.northstar.reddit-crm.plist`).

## Setup

```bash
npm install
cp .env.example .env      # fill it in — see the list inside
npx prisma migrate deploy
npx prisma generate
npm run dev               # localhost:3001
```

`npm run db:seed:demo` gives a working dataset with fake numbers.

## How data gets in

Two sources, each doing the one thing it is good at:

- **Reddit's RSS feed enumerates.** It is the only source that will list an
  NSFW account's posts. The RapidAPI host answers `success: true` with an empty
  array for accounts posting several times a day.
- **The RapidAPI host measures.** Given a post id it returns score, comments
  and removal reason without complaint — it just will not list them.

`src/lib/reddit/oauth-provider.ts` is written and dormant. Set
`REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD` and it takes over
automatically, replacing both. That is the recommended fix.

## The rule that governs this codebase

**An absence is never an answer.** Empty listings, 404s and "user not found"
all arrive from healthy accounts, in streaks lasting minutes. Every one of them
has caused real data loss here:

- a 404 marked live posts removed → survival read 20% when it was 75%
- one "not found" retired accounts permanently → 6 of 10 wrongly dead
- an empty listing marked accounts shadowbanned → 4 wrong, one with 128 upvotes
- an empty timeline froze post counts → 9 posts recorded where 83 were made

Anything that concludes from a negative reading must confirm it across
**separate runs**, not retries seconds apart. See `Post.missStreak`,
`enrichSubreddits`, and the health job.

## Jobs

| command | what |
|---|---|
| `npm run posts:rss` | post discovery for accounts in rotation |
| `npm run accounts:comments` | comment history (not yet scheduled) |
| `npm run posts:repair` | re-check everything recorded as removed |
| `npm run spy` | read watched competitor accounts |
| `npm run subreddit:traffic` | posts/day per subreddit |
| `npm run niche:import / :enrich / :report` | subreddit lists |
| `npm run accounts:stage` | move accounts in and out of rotation |

`POST_DISCOVERY`, `POST_METRICS`, `REMOVAL_DETECTION`, `ACCOUNT_HEALTH` run on a
schedule inside the app. `npm run worker` runs the queue and is **not**
supervised — it needs the same treatment as the web process.

## Known gaps

- Comment discovery is manual, not scheduled.
- Posts stop being re-checked after 30 days, so a later removal is missed.
- `FarmingSession`, `Proxy`, `FunnelEvent`, `Conversion`,
  `AccountCreationAttempt` have zero rows — the Overview screen shows tiles
  built on them.
- Weekly visitor counts are not obtainable without an authenticated session.

## Secrets

`.env` is gitignored and holds keys for RapidAPI, TheOnlyAPI, OnlyMonster and
bouncy. `.env.example` lists every variable with empty values. Rotate anything
that was ever shared in a screenshot.
