# Developer guide — Reddit Ops CRM

Internal CRM for an agency running Reddit marketing accounts for OnlyFans
creators. This document is for whoever picks the code up next. It covers what
runs where, the conventions the codebase follows, and — most importantly — the
failure modes that have already cost real data, so they are not reintroduced.

---

## 1. Getting it running

```bash
git clone https://github.com/MadMAxX-0/reddit-ops-crm.git
cd reddit-ops-crm
npm install
cp .env.example .env          # fill in — every variable is listed there
npx prisma migrate deploy
npx prisma generate
npm run dev                   # http://localhost:3001
```

Postgres 16 and Redis must be reachable. `npm run db:seed:demo` fills a working
dataset with invented numbers so every screen has something to show.

### Three files you will be sent separately

They are gitignored on purpose and are **not** in the repository:

| file                          | what it holds                                     |
| ----------------------------- | ------------------------------------------------- |
| `.env`                        | API keys, database URL, auth secret               |
| `prisma/roster.local.ts`      | the farming roster — ~60 live account handles     |
| `prisma/roster.local.data.ts` | the promotion accounts and the models behind them |

Each has a committed `.example` beside it showing the shape. The app runs
without them; seeding the real roster does not.

**The database is not in the repo.** The code is one thing; the 300 posts, 71
accounts, 213 researched subreddits and 134k fan records are another. Either
point `DATABASE_URL` at the shared hosted database, or ask for a `pg_dump`.
A fresh clone is an empty CRM.

### Commands

```bash
npm run dev            # app on :3001
npm run worker         # BullMQ worker — scheduled jobs. NOT supervised, see §7
npm run typecheck      # tsc --noEmit. Run before every commit
npm run build          # production build
npx prisma studio      # browse the database
```

Formatting is Prettier with **`--no-semi --single-quote --print-width 100`**.
There is no config file, so pass the flags:

```bash
npx prettier --no-semi --single-quote --print-width 100 --write <paths>
```

---

## 2. Stack and layout

Next.js 16 App Router with Turbopack, React 19, TypeScript, Tailwind v4
(CSS-first `@theme` in `src/app/globals.css` — there is no
`tailwind.config.js`), Prisma 7 with `@prisma/adapter-pg`, NextAuth v5,
BullMQ on Redis.

```
src/
  app/
    (app)/            every signed-in screen; the route group holds the shell
    api/              route handlers, incl. /api/diag/reddit
    f/                public link-forwarder — bypasses auth in the proxy matcher
    login/
  components/
    shell/            PageHeader, TabRow, nav rail
    filters/          shared filter controls that write to the query string
    ui/               buttons, cards, chart theme
  lib/
    queries/          every read. One file per screen or concept
    jobs/             scheduled work; registry.ts maps job type → runner
    reddit/           the providers, RSS reader, removal classification
    posting/          the daily-order algorithm
    onlyfans/         revenue attribution (optional to the Reddit side)
    rbac.ts           nav AND route guarding, single source of truth
prisma/
  schema.prisma       42 models
worker.ts             the job runner process
```

**`src/proxy.ts`** is the middleware (Next 16 renamed it). It guards routes
using `rbac.ts`, so adding a screen means adding a nav entry — anything unlisted
fails closed.

---

## 3. How Reddit data actually arrives

Read this before touching anything in `src/lib/reddit/`.

**Two sources, each doing only what it is good at.**

**Enumeration — Reddit's own RSS.** `src/lib/reddit/rss.ts`.
`https://www.reddit.com/user/<name>/submitted.rss`, read twice: plain for the
newest 25 and `?sort=top&t=all` for the best 25 ever. It is the only source that
will list an NSFW account's posts. Subreddit feeds (`/r/<x>/new.rss`) work the
same way and give posts-per-day. Rate limited hard — expect `429`, back off,
keep asking. **`403` on a user feed means the account is banned; `429` means
throttled.**

**Measurement — the third-party API.** `src/lib/reddit/rapidapi-provider.ts`.
Given a post id it returns score, comments and Reddit's `removed_by_category`.
`getProfile`, `getSubredditInfo`, `getSubredditRules` and
`getCommentsByUsername` are all reliable.

**What does not work:** `getPostsByUsername` returns `success: true` with an
empty array for accounts posting several times a day, in streaks lasting tens
of minutes — measured at 13 accounts × 10 attempts, 9 still empty.
`getPostsBySubreddit` returns empty for every NSFW subreddit. reddit.com's JSON
endpoints are `403` from everywhere. Only `.rss` gets through.

**`src/lib/reddit/oauth-provider.ts` is written and dormant.** Set
`REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD` and `redditProvider()` picks
it automatically, replacing both sources. It removes every failure mode above.
Verify with `npm run reddit:oauth:check`, which makes five consecutive reads —
one success proves nothing here.

---

## 4. The rule the codebase turns on

**An absence is never an answer.**

Empty listings, 404s and "user not found" arrive constantly from healthy
accounts, in streaks lasting minutes. Each of these shipped, and each destroyed
real data:

| assumption                              | cost                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| a 404 means the post was removed        | survival read 20% when it was 75%; 27 posts restored in one repair   |
| one "user not found" means suspended    | 6 of 10 promotion accounts wrongly retired                           |
| an empty subreddit listing means hidden | 4 accounts marked shadowbanned, one pulling 128 upvotes that morning |
| an empty timeline means no posts        | counts froze at 9 where 83 had been made                             |
| "subreddit not found" means gone        | 18 condemned, 4 alive, one with 174k members                         |

**So:**

1. **Confirm across separate job runs, not retries seconds apart.** A retry two
   seconds later lands inside the same streak. See `Post.missStreak` — three
   consecutive failed runs before a post is written off, any success resets it.
2. **Make it reversible.** `status` is what is true now and must move both ways;
   `flag` is history and is raise-only. Never build a one-way door — the
   suspended-account check used to exclude suspended accounts from ever being
   re-checked.
3. **Never write an absent snapshot through.** A subreddit that 404s must not be
   stored as "0 subscribers, SFW, no rules" — that reads as the safest target on
   the list. See `unavailable` on `DiscoveredSubreddit`.
4. **Unknowns get their own bucket.** `RemovedBy.UNKNOWN` is never folded into
   `MOD` or `REDDIT`.

**Karma is the fallback truth signal.** Rising `link_karma` proves an account
posted even when nothing can see the post.

---

## 5. Conventions worth following

**One definition of "an account we are running."** `src/lib/queries/rotation.ts`
exports `IN_ROTATION` and `ROTATION_ACCOUNT`. Use them in every query that
reports posting. It exists because the rule was written inline in one query and
missed in another, so the dashboard cards and the leaderboard beneath them
counted different populations.

**Every number on a screen describes the same window.** A header on 30 days
above rows on 7 produces "21 posted, 22 live" — a row that cannot be true.

**Tri-state requirement fields.** On `DiscoveredSubreddit`, `null` in
`minKarma`, `requiresVerification`, `originalContentOnly` etc. means **NOT
STATED**, never "no". A rule the mods did not write down is a rule nobody has
read.

**Time formatting.** Show hours under 48, days after. The shared relative
formatter rounds 25 hours to "1d", which next to a 24-hour window reading zero
looks broken.

**`cn()` and numeric type classes.** The type scale is `text-13`, `text-16`,
`text-36`. tailwind-merge cannot tell those from a colour like `text-fg` unless
told — `src/lib/utils.ts` registers them. **Add any new size there** or
`cn('text-48','text-fg')` silently drops the size.

**KPI numbers use `.kpi`**, a hand-written rule in `globals.css`, not a utility
class. Utilities only exist if Tailwind's scanner saw them, and the dev
stylesheet is served under a filename that does not change between builds — a
cached copy turns a new `text-NN` into a no-op.

**Comments explain why, not what.** Most non-obvious code here has a comment
naming the specific failure it prevents. Keep that up; it is why the traps above
are documented at all.

---

## 6. Screens

| route                                       | question it answers                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/dashboard`                                | how is Reddit doing — clicks, fans, revenue, posts, upvotes, comments over time       |
| `/accounts` (Tracker)                       | which accounts, and who works them. Grouped by VA, expandable to each account's posts |
| `/posting`                                  | today's posting order: pick account + list + count + sort                             |
| `/pipeline`                                 | what is being created and warmed, and what died                                       |
| `/admin/scraper`                            | build subreddit lists: add usernames → discover subreddits → read their rules         |
| `/spy`                                      | watched competitor accounts, their rhythm, and a swipe file of their posts            |
| `/admin/users`, `/admin/audit`, `/settings` | staff, audit log, workspace                                                           |

Parked at 404 with `.bak` files beside them: Reports, Subreddit Lists, and the
old Overview and Performance screens (both duplicated Dashboard and Tracker).

---

## 7. Jobs

`worker.ts` runs BullMQ; `src/lib/jobs/registry.ts` maps job type to runner.

| job                 | cadence                   | notes                                                                                    |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| `POST_DISCOVERY`    | 5 min, tiered per account | RSS first, API fallback. HOT (posted in 24h) 10 min, WARM hourly, COLD 6h, DORMANT daily |
| `POST_METRICS`      | continuous                | posts under 7 days; writes `PostMetric` rows                                             |
| `REMOVAL_DETECTION` | continuous                | posts 7–30 days old; uses `missStreak`                                                   |
| `ACCOUNT_HEALTH`    | daily                     | karma, age, suspension. Re-checks suspended weekly so a wrong call self-corrects         |
| `SUBREDDIT_RULES`   | 14-day staleness          | rules and capabilities                                                                   |

Manual scripts:

```bash
npm run posts:rss                     # force post discovery
npm run posts:repair                  # re-check everything recorded as removed
npm run accounts:history -- --force   # walk full timelines again
npm run accounts:comments             # comment sweep
npm run accounts:stage -- --farming u/name
npm run spy                           # refresh watched accounts
npm run subreddit:traffic -- --limit 60
npm run niche:import / :enrich / :report / :split
npm run subreddit:purpose             # mark subs promo or farming
npm run plan -- u/Account "Trans" 15 members
```

> **`npm run worker` is not supervised.** The web process is, by a launchd agent
> (`~/Library/LaunchAgents/com.northstar.reddit-crm.plist`). The worker needs the
> same treatment or scheduled jobs stop silently — which, given §4, is the
> failure you would notice last.

---

## 8. Deployment

**Render fits better than Vercel.** This needs a long-running worker, Redis,
Postgres and repeating jobs; on Vercel that is four vendors and a rewritten
scheduler. A `render.yaml` covering web + worker + Postgres + Redis is in
`BUILD-PROMPT.md` §Deployment.

**Before trusting a deployment, hit `/api/diag/reddit` on it.** It is public —
you need it before there is a login to get past. It fetches a user feed, a
subreddit feed and a JSON endpoint and returns a verdict:

- `ok` — the host can read Reddit, scrapers can run there
- `blocked` — set `REDDIT_PROXY_URL` to a residential exit and try again

Do not assume either result. Reddit blocks its JSON endpoints from everywhere,
but RSS is consumed by hosted feed readers all day.

`AUTH_URL` must match the deployed origin — it is `localhost:3001` in
development and pointing it at the wrong port sends logins to the wrong app.

---

## 9. Known gaps

Honest list, roughly in the order I would fix them:

1. **Comment discovery is manual.** `npm run accounts:comments` is not on the
   schedule. Warming accounts do all their work in comments, so without it a
   third of the roster reads as idle.
2. **Posts stop being re-checked after 30 days.** A removal on day 40 is never
   recorded.
3. **The worker is unsupervised.** See §7.
4. **Five tables have never had a row written:** `FarmingSession`, `Proxy`,
   `FunnelEvent`, `Conversion`, `AccountCreationAttempt`. Anything built on
   them shows zeros that look like measurements.
5. **Weekly subreddit visitor counts are not obtainable** without an
   authenticated session. `postsPerDay` from the subreddit feed is the
   substitute, and is arguably the better number — it measures how fast a post
   gets buried.
6. **Trial links** (`/trial/<token>`, no campaign code) leave ~75k clicks
   unattributed.
7. **Three OnlyFans accounts are not connected** to the data provider, so six
   Reddit accounts show no clicks despite having live tracking links.

## 10. Security

`.env` and both roster files are gitignored and were deliberately kept out of
git history. Nothing in the tracked tree names a live account. Keep it that way:
a roster of handles is the one artefact a competitor can act on directly.

The repository is private. `scripts/lists/*.tsv` alone is days of subreddit
research and directly reusable.

Rotate any credential that has been shared in a screenshot or a chat.
