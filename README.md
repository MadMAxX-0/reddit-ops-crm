# Reddit Operations CRM

Internal CRM for an agency running Reddit marketing for OnlyFans creators. Two
VA roles: **posters** publish promo posts from agency-owned Reddit accounts, and
**farmers** create and warm up the accounts that give posters inventory.

## The one architectural fact that shapes everything

**This system never writes to Reddit, and VAs never log their posting work.**

There is no composer, no scheduler, and no "mark as posted" button anywhere in
the product. VAs post manually on Reddit; the CRM discovers those posts by
polling the timeline of every account it knows about, then enriches them with
metrics over time.

That buys one large thing and costs one large thing:

- **The benefit:** VA output is observed, not self-reported, so it cannot be
  inflated. A poster's daily count comes entirely from what the scraper found,
  and the Posting page says so on the screen.
- **The cost:** discovery is the hardest problem in the build, and anything the
  scraper misses does not exist as far as the business is concerned. A post
  removed by a mod before we polled never appears on the timeline, so it is
  invisible and the removal rate silently understates itself.

The system does not pretend that gap away. It keeps hot-tier polling tight,
monitors the median `firstSeenAt - postedAt` on the Scraper page, and counts
accounts whose karma moved with no discovered post as **suspected missed posts**
rather than reporting a complete record.

The one exception is warm-up: there is nothing on Reddit that proves an account
was farmed for twenty minutes, so farming sessions are genuinely self-reported —
and labelled as such where they appear.

## What is on screen

The product is deliberately narrow. Six screens:

| Screen | Who |
|---|---|
| **Grid** — poster → account × day, the landing page | everyone (a poster sees only their own section) |
| Account database | everyone |
| Account creation | farming VAs, managers |
| Farming sessions | farming VAs, managers |
| Scraper | managers |
| Users | admins |

Overview, Posting, Deep links, Reports, Employee ranking, Subreddit lists, My
performance and Audit logs were built and then routed out — they still exist in
the codebase but are unreachable, because `canAccess` fails closed on anything
absent from `NAV` in `src/lib/rbac.ts`. Putting one back is one line. Nothing
was deleted.

## Running it

Requires Node 20+, Postgres 16 and Redis.

```bash
# infrastructure — either of these
docker compose up -d
# ...or Homebrew
brew services start postgresql@16 redis && createdb reddit_crm

cp .env.example .env      # then fill in AUTH_SECRET and CREDENTIAL_ENC_KEY
npm install
npm run db:migrate
npm run db:seed:real      # the real roster, live account facts from Reddit
npm run job -- discovery  # pull the real post history

# ...or the synthetic 90-day dataset instead
npm run db:seed:demo

npm run dev               # web app        → http://localhost:3000
npm run worker            # scraper worker → BullMQ + Redis
```

Two seeds. `db:seed:real` is the real operation — two posters, three farming
VAs, seven models, the ten accounts actually in rotation, with karma and account
age read live from Reddit. `db:seed:demo` is the 90-day synthetic history used
to exercise the charts and the virtualised tables.

Sign in with password `password123`:

| Role | Email |
|---|---|
| Admin | `admin@agency.local` |
| Poster | `bev@agency.local`, `leo@agency.local` |
| Farming VA | `creation@agency.local`, `farming1@agency.local`, `farming2@agency.local` |

Run a scraper job by hand without the queue:

```bash
npm run job -- discovery --limit 60
npm run job -- metrics | removal | health | subreddits | of-sync | all
```

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 7 + Postgres ·
BullMQ + Redis · Recharts · TanStack Table · NextAuth v5.

All money is an integer number of **cents**. All timestamps are stored in **UTC**.

## The two timezones

These are separate settings and conflating them is the most common source of
"the numbers are wrong" in an operation spread across timezones:

- **`Workspace.dayBoundaryTimezone`** decides what *a day* means. Every daily
  aggregate — creation counters, goal bars, the employee ranking, the daily ops
  brief — buckets by this zone. It is a property of the operation.
- **`User.timezone`** decides only how an instant is *rendered* for one viewer.
  Changing it never moves a number between days.

Every screen carrying a daily figure prints both in its header:
`2026-08-20 · Africa/Lagos day · timestamps Asia/Dubai`.

## How the data fits together

### Ingestion (`src/lib/reddit`, `src/lib/jobs`)

Everything goes through a `RedditProvider` interface, so the data source can be
swapped without touching the app. Two implementations ship:

- `RapidApiRedditProvider` — a RapidAPI Reddit host (`reddit34` by default).
  Currently in use. Needs `RAPIDAPI_KEY`. Reads the monthly quota off the
  response headers so the budget is visible rather than discovered by hitting
  the ceiling.
- `PublicRedditProvider` — reddit.com's own public JSON endpoints, with a
  process-wide token bucket, jittered backoff and 429 handling.
- `SimulatedRedditProvider` — a local stand-in. Not a test mock: it behaves like
  the source of truth the scraper faces, so discovery lag, removal detection and
  the missed-post signal are exercisable with no network.

Switch with `REDDIT_PROVIDER=rapidapi|public|simulated`, and verify any switch
with `npm run reddit:check` before pointing the scraper at it — a provider that
authenticates but returns the wrong shape looks exactly like an inventory full
of dead accounts.

**The API only returns what is still live on a profile.** A post removed by a
moderator is gone from the timeline entirely, so it can never be discovered.
That is the discovery gap made concrete, and it is why the grid can show fewer
active days than the team knows happened.

Five jobs, all recorded in `ScraperJob` so the Scraper admin page shows real
status rather than a green dot that always lies:

| Job | What it does |
|---|---|
| **Post discovery** | Polls each account timeline, diffs against known post ids, inserts what is new. The primary loop. |
| **Post metrics** | Appends a `PostMetric` snapshot on a decaying cadence for 7 days. Never overwrites. |
| **Removal detection** | Sweeps posts that have aged out of the metrics window. |
| **Account health** | Daily karma, age, suspension; shadowban detection; the missed-post signal. |
| **Subreddit rules** | Weekly refresh of rules, verification requirements and subscriber counts. |

Discovery polls on a **tier**, not one interval, because the polling budget is
the real constraint. All four intervals are config values in `ScraperConfig`,
editable on the Scraper page:

| Tier | Definition | Default |
|---|---|---|
| Hot | posted in the last 24h | 10 min |
| Warm | posted in the last 7d | 1 hour |
| Cold | assigned to a poster, no post in 7d | 6 hours |
| Dormant | in warm-up or unassigned | 24 hours |

Removal detection is folded into the metrics job for posts inside the 7-day
window: we already hold a fresh snapshot there, and paying twice for the same
fetch comes straight out of the polling budget. The standalone job covers the
long tail.

### Attribution

Two rules carry most of the weight.

**Posts belong to whoever held the account at `postedAt`.** `AccountAssignment`
is a time-boxed custody history, and ingestion resolves creator and poster from
the span that was open at the moment of posting. Reassigning an account today
never rewrites what happened last month. When no span was open, the post is
marked `NEEDS_REVIEW` and routed to a manager queue — never guessed at, never
dropped, because unattributed posts are how VA numbers quietly go wrong.

**One tracked link per Reddit account**, issued at creation and never
reassigned. The account is the unit, so everything else resolves downstream. The
funnel page *is* the tracking layer — there is no separate redirector:

```
Reddit post → bio link       funnel.com/{slug}       FunnelEvent: LANDED
            → outbound       the CTA on that page    FunnelEvent: OUTBOUND
            → OF link        one per Reddit account  (OF's own attribution)
            → subscription   OnlyFans API            Conversion
```

Minting one OF tracking link per Reddit account is what makes
`ofTrackingLinkId` a real join key between funnel data and revenue data.
Without it, traffic and subs live in two systems with nothing connecting them.

An unknown slug never errors: it is logged, alerted on, and still forwarded
somewhere that works, because a broken bio link on a live account is silent
revenue loss.

When several of an account's posts were live at once, a landing is attributed by
a **weighted random pick** across them by upvote velocity, recorded as
`INFERRED` with the winner's share as the confidence. A landing physically
happened once, so it stays one row; across many landings the split converges on
the true proportion, and reports disclose the inferred share.

### Metrics (`src/lib/queries/metrics.ts`)

One module computes period metrics; Overview, Dashboard, My Performance, the
Employee Ranking and the AI report context all read from it, so a rate can only
be defined once and cannot drift between screens.

`ctrProxy` is landings per upvote. Reddit does not expose impressions, so
upvotes stand in for reach — it is labelled a proxy everywhere it appears.

## The AI reporting engine (`src/lib/reports`)

`buildReportContext(scope, scopeId, period)` returns a compact JSON object:
period totals, prior-period comparison, per-subreddit and per-creator
breakdowns, top and bottom performers, z-scored anomalies against a trailing
30-day baseline that excludes the period itself, and a `dataQuality` block.

It is ~11 KB whether the period is one day or thirty. That keeps token cost flat
and, more importantly, means the model can only cite numbers that are actually
in the object. The exact context is stored with the report, so any figure can be
walked back to its source from the UI.

The model returns strict JSON enforced at the API layer, and is instructed to
cite only supplied figures, to say when a sample is too small to be meaningful,
and to distinguish correlation from causation. Reports are versioned; re-running
one writes v2 alongside v1 rather than replacing it.

Set `ANTHROPIC_API_KEY` to enable generation. Without it the Reports screen says
so plainly and everything else in the product still works. The seed writes one
example report labelled `seed-fixture` so the screen has something to render —
its prose is hand-written, but its context object and traceability panel are
real.

## Notable deliberate choices

- **Health scores are capped per input.** A 300-day-old account with 40k karma
  is not twice as healthy as a 120-day-old one, and a score that pins at 100 for
  half the inventory is useless for triage.
- **7-day survival means different things per role.** A farmer is judged on the
  accounts they *created*; a poster on the accounts they *hold*. Accounts are
  handed to posters at ~21 days, by which point they have already survived their
  first week — measuring the farmer metric on posters would read 100% for
  everyone, which is worse than not measuring it.
- **Conversions are walked back to a post through one outbound click**
  (`LATERAL … LIMIT 1` inside the attribution window). Joining on tracked link
  alone multiplies every conversion by that link's entire click history — it
  reads as spectacular conversion rates and revenue that does not reconcile.
- **Subreddit tiering blends conversion rate and removal rate, never subscriber
  count.** A two-million-subscriber sub that removes 40% of what you send is a
  time sink with a big number next to it. Hand-set tiers stick; the
  auto-suggestion proposes and never overrides.
- **`PostMetric` is append-only.** That is what lets you plot an upvote curve and
  see a post die three hours after it peaked, rather than just seeing a low
  final number.

## Layout

```
prisma/schema.prisma        data model
prisma/seed.ts              90 days of internally-coherent history
worker.ts                   BullMQ worker: scrapers + report scheduler
src/lib/reddit/             provider interface, public + simulated impls
src/lib/jobs/               the five jobs, runner, queue, rate limiting
src/lib/queries/            every aggregate the UI reads
src/lib/reports/            context builder, prompts, output contract
src/lib/funnel.ts           landing/outbound logging and attribution
src/app/f/[slug]/           the public funnel page — the tracking layer
src/app/(app)/              the authenticated product
```

## Scripts

| Command | |
|---|---|
| `npm run dev` | web app |
| `npm run worker` | scraper worker and report scheduler |
| `npm run job -- <name>` | run one job in-process |
| `npm run db:migrate` / `db:seed:real` / `db:seed:demo` / `db:reset` | database |
| `npm run reddit:check` | read-only check of the configured Reddit provider |
| `npm run typecheck` / `lint` / `build` | checks |
