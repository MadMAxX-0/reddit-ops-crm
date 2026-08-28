# Build prompt — Reddit Ops CRM

Paste everything between the lines into a coding agent. It is a complete
specification: stack, data sources, every screen, every field, the scraping
methods, and the failure modes that must be designed around.

---

## What you are building

An internal CRM for an agency that runs Reddit marketing accounts for OnlyFans
creators. Roughly a dozen Reddit accounts in active rotation, sixty more being
warmed up, two to six staff. It answers four questions:

1. **What went out, and did it survive?** Posts per account, per window, split
   by who removed them.
2. **Which accounts and which staff are producing?** Accounts grouped by the VA
   who works them.
3. **Where should we post next?** Curated subreddit lists, each subreddit's
   published rules, and a generated daily posting order.
4. **What are competitors doing?** Watched accounts, their posting rhythm, and
   a saved library of posts worth copying.

## Stack

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**
- **Tailwind v4** — CSS-first `@theme`, no `tailwind.config.js`
- **Prisma 7** + `@prisma/adapter-pg` on **PostgreSQL 16**, client generated to
  `src/generated/prisma`
- **NextAuth v5** (credentials), route guarding in `src/proxy.ts` (Next 16's
  renamed middleware)
- **BullMQ + Redis** for scheduled jobs, run by a separate `worker.ts` process
- **Recharts** for charts, **TanStack Table**, **lucide-react**, **Radix**
- Formatting: Prettier with `--no-semi --single-quote --print-width 100`

Dark UI. True black page, cards one shade above it, hairline borders, one orange
accent. Green and red mean direction of change only, never decoration.

---

# THE MOST IMPORTANT PART: how Reddit data is actually obtained

Read this before writing any scraping code. Getting it wrong silently destroys
data, and it is not obvious from the outside.

## Two sources, each doing only what it is good at

**Reddit's RSS feeds ENUMERATE. A third-party API MEASURES.**

### Enumeration — `https://www.reddit.com/user/<name>/submitted.rss`

This is the only source that will list an NSFW account's posts.

- Returns `200` with an Atom feed. Read it **twice**: plain (newest 25) and
  `?sort=top&t=all` (best 25 ever). A feed carries 25 entries whichever way it
  is sorted, so the two together reach months back instead of days.
- Each `<entry>` gives: `<id>` = `t3_xxxxx` (the post id), `<category term>` =
  subreddit, `<title>`, `<link href>` = permalink, `<updated>` = post time,
  `<media:thumbnail url>` = preview image, and the outbound link inside the
  `<content>` HTML as the anchor labelled `[link]`.
- **No score.** Scores come from the other source.
- Subreddit feeds work the same way: `/r/<name>/new.rss?limit=100`. Use the
  timestamps to compute posts-per-day, which is the only obtainable measure of
  how busy a subreddit is.
- **Rate limited hard.** Expect `429` after a few calls in quick succession.
  Back off exponentially and keep asking. Walk accounts one at a time with a
  ~6 second gap.
- **`403` means the account is banned.** `429` means throttled. That distinction
  is the most reliable ban detector available.

### Measurement — a third-party Reddit API (this build used `reddit34` on RapidAPI)

- `getPostDetails?post_url=<permalink>` returns any individual post: score,
  comment count, and Reddit's `removed_by_category`. **This works reliably.**
- `getProfile?username=` returns karma and account age. **Also reliable.**
- `getSubredditInfo?subreddit=` returns subscribers, `over18`,
  `submission_type` (`any`/`link`/`self`), `allow_images`, `allow_videos`,
  `allow_galleries`, `subreddit_type`, `quarantine`, `created_utc`,
  `submit_text`. **Reliable.**
- `getSubredditRules?subreddit=` returns the subreddit's published rules.
- `getCommentsByUsername?username=&sort=new` returns comment history.
  **Reliable** — often the only thing that answers for a warming account.

### What does NOT work, and must not be relied on

- **`getPostsByUsername` returns `success: true` with an empty array** for
  accounts posting several times a day, in streaks lasting tens of minutes.
  Measured: 13 accounts × 10 attempts each → 9 still empty, 0 posts from the
  last 24h recovered. Not caching (cache-busting params, `no-cache`, `limit`,
  `cursor`, `after` all identical), not headers, not NSFW-specific.
- **`getPostsBySubreddit` returns empty for every NSFW subreddit.** 7 of 7 NSFW
  tested returned 0 posts; 4 of 4 SFW returned 25.
- **reddit.com's JSON endpoints are 403** from any client — `/about.json`,
  `oauth.reddit.com`, `api.reddit.com`, `old.reddit.com`. All return the same
  ~190KB bot-wall page. Only `.rss` gets through.
- **Weekly visitor counts do not exist publicly.** They are a sidebar field on
  the logged-in web page only.

### Recommended: Reddit's official OAuth API

Write an `OAuthRedditProvider` behind the same interface and prefer it whenever
`REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD` are set. A "script" app from
reddit.com/prefs/apps, password grant against
`https://www.reddit.com/api/v1/access_token`, then `https://oauth.reddit.com`
with a Bearer token and a real User-Agent. The linked account must be 18+ with
NSFW enabled and no 2FA. This removes every failure mode above.

---

# THE RULE THE WHOLE CODEBASE TURNS ON

**An absence is never an answer.**

Empty listings, 404s and "user not found" all arrive constantly from perfectly
healthy accounts and subreddits, in streaks lasting minutes. Every one of these
happened in the original build and each destroyed real data:

| what was assumed | what it cost |
|---|---|
| a 404 means the post was removed | live posts marked removed; survival read 20% when it was 75%. 27 restored in one repair pass |
| one "user not found" means suspended | accounts retired permanently; 6 of 10 promo accounts wrongly dead |
| an empty subreddit listing means the post is hidden | 4 accounts marked shadowbanned, one pulling 128 upvotes that morning |
| an empty timeline means no posts | post counts froze; 9 posts recorded where 83 had been made |
| a "subreddit not found" means it is gone | 18 subreddits condemned, 4 alive, one with 174k members |

**Therefore, every conclusion drawn from a negative reading must:**

1. **Be confirmed across separate job runs**, not retries seconds apart. A retry
   two seconds later lands inside the same streak. Store a counter on the row
   (`Post.missStreak`) and only act at three consecutive failures. Any
   successful read resets it to zero.
2. **Be reversible.** If evidence later contradicts it, the status must return.
   Status reflects what is true now; a separate `flag` column keeps the history.
   Never write a one-way door.
3. **Never write an absent snapshot through.** A subreddit that 404s must not be
   recorded as "0 subscribers, SFW, no rules" — that reads as the safest target
   on the list. Record `unavailable: true` and touch nothing else.
4. **Keep unknowns in their own bucket.** A removal with no stated cause is
   `UNKNOWN`, never folded into `MOD` or `REDDIT`.

Also: **karma is the fallback truth signal.** Rising `link_karma` proves an
account posted even when nothing can see the post.

---

# DATA MODEL

Postgres via Prisma. Money in integer cents. All timestamps UTC, with a
workspace-level day-boundary timezone for daily rollups.

## Core

**`RedditAccount`** — `username`, `passwordEnc`, `emailAddress`,
`redditCreatedAt`, `karmaPost`, `karmaComment`, `followers`, `status`
(ACTIVE / WARMING / SUSPENDED / SHADOWBANNED / RETIRED), `pipelineStage`
(CREATING / FARMING / ACTIVE), `flag` (NONE / BANNED / SHADOWBANNED — raised,
never cleared), `assignedCreatorId` (the model), `assignedPosterId` (the VA),
`device`, `proxyId`, `verifiedSubreddits[]`, `healthScore`, `pollTier`
(HOT/WARM/COLD/DORMANT), `nextPollAt`, `lastPostAt`, `suspectedMissedPosts`,
`historyWalkedAt`.

> `pipelineStage: ACTIVE` is the definition of "an account we are running".
> Export it as a single shared constant (`IN_ROTATION`) and use it in every
> query that reports posting. Writing it inline is how one screen ends up
> counting a different population from the screen above it.

**`Post`** — `redditPostId` (unique, `t3_…`), `redditAccountId`, `subredditId`,
`creatorId`, `posterId`, `title`, `flair`, `mediaType`, `url`, `mediaUrl`,
`thumbnailUrl`, `selftext`, `postedAt`, `firstSeenAt`, `status`
(LIVE/REMOVED/DELETED), `removedAt`, `removalReason` (Reddit's raw
`removed_by_category`), `removedBy` (enum MOD / REDDIT / AUTHOR / UNKNOWN),
`missStreak`, `latestUpvotes`, `latestComments`, `latestUpvoteRatio`,
`lastMetricAt`.

> `removedBy` classification: `moderator`, `automod_filtered`, `community_ops`
> → **MOD**. `reddit`, `anti_evil_ops`, takedowns → **REDDIT**. `deleted`,
> `author` → **AUTHOR**. Anything else → **UNKNOWN**. Never sum MOD and REDDIT:
> a mod removal means the subreddit was wrong and the account is fine; a Reddit
> removal means the site filtered it and the account is in trouble.

**`RedditComment`** — comments our accounts LEAVE. `redditCommentId` unique,
`subreddit`, `linkTitle`, `permalink`, `body` (trimmed), `score`, `postedAt`.
Essential: warming accounts post nothing and comment constantly, and the largest
subreddit on these lists gates on *comment* karma.

**`PostMetric`** — upvote/comment snapshots over time, for trajectory charts.

**`AccountHealthSnapshot`** — daily karma, followers, shadowban/suspended flags,
health score. This is what makes karma-delta a usable posting signal.

**`Subreddit`** — subreddits we have posted in. Includes `purpose`
(PROMO / FARMING) because the same account posts to both kinds and `isNsfw` does
not separate them: r/Shrek and r/spongebob come back flagged NSFW while
r/parrots does not.

**`Creator`** (the model), **`User`** (staff: ADMIN / MANAGER / POSTER /
FARMER), **`AccountAssignment`** (history of who worked what, so attribution is
correct as of the post date).

## Subreddit research

**`DiscoveredSubreddit`** — `name` unique, `subscribers`, `over18`,
`unavailable`, `dismissed`, `promoted`, plus:

- **Requirements, every one nullable and tri-state.** `minKarma`,
  `minAccountAgeDays`, `requiresVerification`, `originalContentOnly`,
  `bansAskingForUpvotes`. **`null` means NOT STATED, never "no".** A rule the
  mods did not write down is a rule nobody has read, and treating silence as
  permission is how accounts get banned.
- **Capabilities, from Reddit's own switches:** `submissionType`,
  `allowsImages`, `allowsVideos`, `allowsGalleries`, `subredditType`,
  `quarantined`, `subCreatedAt`, `submitText`. (Do not surface
  `restrict_posting` — it reads true for every subreddit including r/parrots.)
- **Traffic:** `postsPerDay`, `trafficCheckedAt`, measured from the subreddit's
  own RSS feed.
- `rulesJson` — every rule as returned, so a judgement can be checked.

**`SubredditNiche`** + **`SubredditNicheItem`** — named lists (e.g. "Trans",
"Femboy"). An item's `note` carries the verdict that put it there.

## Competitor research

**`ScrapeTarget`** — a watched account. `username`, `tags[]` (a **fixed
vocabulary** — free text drifts into `latina`/`Latina`/`latinas` within a week
and the filter bar becomes useless), `karma`, `karmaPrev` (so the table shows
movement, not a standing total), `active`, `lastScrapedAt`, `lastError`.

**`TargetPost`** — their individual posts: subreddit, title, url, thumbnail,
media link, score, comments, postedAt.

**`SpyAlbum`** + **`SpyAlbumPost`** — a swipe file of *their posts* worth
copying. Albums hold posts; tags describe accounts. Keeping them separate
matters: "Latina creators" is a fact about a person, "this title worked" is a
fact about a post, and one list cannot hold both usefully.

## Money (optional — only if attribution is needed)

`OfCampaign` (tracking links), `OfFan`, `OfFanClaim`, `OfTransaction`,
`BouncyLink` + `BouncyClickDay` (click days per short link).

> Attribution rule, arrived at by getting it wrong first: **a fan belongs to
> every link they claimed, permanently.** Last-touch halved the real figure.
> Each payment counts once in a total however many links its fan claimed;
> per-link rows do double-count, so say so wherever both appear.

---

# SCREENS

## 1. Dashboard — "how is Reddit doing?"

Range presets 24h / 7d / 30d, and a model picker listing **every** model with
"(not connected)" beside any without an OnlyFans account — hiding them makes
people think they are missing.

**Six cards, in funnel order:** Clicks · Fans · Revenue · Posts · Upvotes ·
Comments. Each with a delta against the previous period.

> Posts, Upvotes and Comments are read off Reddit and must **never** be nulled
> out when a model is unconnected. The first three depend on OnlyFans and show
> "—" (not zero) when unmeasurable.

**Six stacked charts**, one per metric, same order, each with its own panel and
its own y-axis. Do not overlay them — three scales fighting over one gridline
means the small one always loses. Sharing an x-axis by sitting directly above
each other is what makes "spiked in clicks, flat in fans" visible.

Then **best performing posts** — thumbnail, title, subreddit, account, upvotes.
Scoped to accounts in rotation, or the leaderboard fills with karma-farming
memes.

## 2. Tracker — "which accounts, and who works them?"

Accounts in rotation, **grouped by the VA who works them**.

A window switcher (24h / 7d / 30d) **above** the tiles that drives every number
on the page. Four tiles: Accounts in rotation · Suspended · Posts · Clicks.

Per VA: a header with posts, survival %, upvotes, clicks, fans, comments left.

Per account, one row: username (link to Reddit **and** to the account drawer),
model, state, karma, age, **Posts · Live · Mods · Reddit · Avg ↑ · Replies ·
Comments left · Clicks · Fans · Last post**.

> **Every number in a row must describe the same window.** Mixing them produces
> rows reading "21 posted, 22 live", which is not a rounding quirk — it is a row
> that cannot be true.
>
> **Show hours until 48, then days.** A relative formatter that rounds 25 hours
> to "1d" sits next to a 24-hour window showing zero posts and looks broken.
>
> **Split removals by cause and never total them.** Colour them differently:
> mods amber, Reddit red.

Expanding a row shows that account's posts: a **Best ever / Latest** toggle,
20 each, with thumbnail, subreddit, title, state (live / mods / reddit /
deleted), score and replies. Two separate lists, not one list sorted two ways —
an account's biggest post is usually months old.

## 3. Posting — the daily order

Pick: **account**, **subreddit list**, **how many posts today**, and **one of
three sorts**. Get back a numbered list with a Copy button.

**The three sorts differ only in what they rank on. Selection and ordering are
identical.**

1. **By size** — subscriber count.
2. **By our results** — the median upvotes we have actually got there. An
   untested subreddit ranks at the **median of what is known**, not the bottom,
   or the list only ever reuses proven subs and never finds a better one.
3. **By traffic** — subscribers ÷ posts-per-day. Reach against competition:
   2M members taking 300 posts a day buries you by lunchtime; 150k taking 40
   keeps you up overnight.

**The selection rule:**

- The list is longer than the day. 30 subreddits, 15 slots — something is left
  out, and it must not be the same thing every day.
- **The top 40% of slots is a fixed head that goes out every day.** The rest
  splits **2:1 between middle and bottom**, longest-unused-first, so nothing
  repeats until its tier has cycled.
- **Tier sizes come from the SLOT COUNT, not from thirds of the list.** With 112
  subreddits and 15 slots, a third-of-the-list tier A holds 37 entries and every
  slot comes from it — the middle and bottom never appear at all, which is
  exactly what the rule exists to prevent.
- **Order within the day runs weakest → strongest.** The best subreddit is the
  last post: an account stopped mid-run loses its worst slots, not its best one.
- **A subreddit is used at most once per account per day**, checked against the
  real post history so a rebuild mid-afternoon gives the rest of the day.

**Requirements are a filter, not a penalty.** A subreddit the account cannot
post in is not a low-ranked option — it is not an option. Exclude on karma
floor, age floor and verification, and say how many were excluded and why.

Each row shows: **# · Subreddit · Members · Type · Info·rules · actions**, where
Type is `NSFW` plus `SFW ok` where clothed posts are allowed, and rules are
chips coloured by consequence — blue for a gate you either clear or you do not,
red for what gets the account banned, amber for what gets the post removed.

Per row: open on Reddit, copy that handle, **⇄ replace** (searchable list of
every unpicked subreddit, best first), **✕ drop** (removes it and pulls up the
next best). A swap **re-sorts** rather than slotting in — the running order is
the point of the screen.

## 4. Account Pipeline

Accounts being created and warmed. Four summary tiles: total accounts, ready to
use (age and karma thresholds), total karma, bans in the last 7 days. Stage
columns, with dead accounts flagged rather than counted as workable.

## 5. Scraper — building subreddit lists

Add usernames → read where they post → read what those subreddits demand.
Discovered subreddits table with requirement columns and filters. Niches:
tiles, chips, grouped table. Dead subreddits struck through, excluded from
counts, behind a "Dead" chip.

> Read **two** endpoints when discovering where an account posts — submissions
> and overview — and merge. One account went from 0 subreddits to 9.

## 6. Spy — watching other accounts

Tracked accounts table: **Account · Karma · Change · Posts · Tags**, where
Change is karma movement since the previous read. A fixed tag vocabulary across
the top as a filter bar with counts and a `clear`.

Expanding shows their posts — **Best ever / Latest**, thumbnails, outbound host,
score, replies — and a **Save to** album chip on every row.

Albums are collections of **posts** (a swipe file), shown as a grid with the
image, where it came from, and a Remove.

## 7. Settings, Users, Audit Logs

Standard. Role-based nav from one source of truth that both the rail and the
route guard read, failing closed for anything unlisted.

---

# JOBS

Run by a separate worker process on BullMQ, plus manual scripts.

| job | cadence | what |
|---|---|---|
| `POST_DISCOVERY` | 5 min, tiered per account | RSS feed first, API fallback. HOT accounts (posted in 24h) every 10 min, WARM hourly, COLD 6h, DORMANT daily |
| `POST_METRICS` | continuous | re-reads posts under 7 days old; writes a `PostMetric` row |
| `REMOVAL_DETECTION` | continuous | posts 7–30 days old, not checked in 3 days. Uses `missStreak` |
| `ACCOUNT_HEALTH` | daily per account | karma, age, suspension. Re-checks suspended accounts **weekly** so a wrong call self-corrects |
| `SUBREDDIT_RULES` | 14-day staleness | rules and capabilities per subreddit |

Manual scripts worth having: full history walk (`--force` re-walks), comment
sweep, removal repair, spy refresh, subreddit traffic measurement, niche
import/enrich/report, account staging.

> A first poll of an account must walk the **whole** timeline with no date
> floor. A 45-day window plus a `since` that only moves forward makes anything
> older permanently unreachable — which is exactly the farming accounts, since
> they earn karma for months before rotation.

---

# DEPLOYMENT

**Render is the better fit than Vercel** for this shape: it needs a
long-running BullMQ worker, Redis, Postgres and repeating jobs. On Vercel that
is four vendors and a rewritten scheduler; on Render it is one blueprint.

```yaml
# render.yaml
services:
  - type: web
    name: reddit-crm
    env: node
    buildCommand: npm ci && npx prisma migrate deploy && npx prisma generate && npm run build
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: reddit-crm-db, property: connectionString }
      - key: REDIS_URL
        fromService: { name: reddit-crm-redis, type: redis, property: connectionString }
      - key: AUTH_SECRET
        generateValue: true
      - key: AUTH_URL
        sync: false

  - type: worker
    name: reddit-crm-worker
    env: node
    buildCommand: npm ci && npx prisma generate
    startCommand: npm run worker
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: reddit-crm-db, property: connectionString }
      - key: REDIS_URL
        fromService: { name: reddit-crm-redis, type: redis, property: connectionString }

databases:
  - name: reddit-crm-db
    plan: basic-256mb
```

Add a Redis (Key Value) instance named `reddit-crm-redis`.

**Before trusting the deployment, verify the host can read Reddit.** Ship a
public diagnostic route (`/api/diag/reddit`) that fetches a user feed, a
subreddit feed and a JSON endpoint, and reports a verdict. Hit it on the
deployed URL. `ok` means the scrapers can run there. `blocked` means route
outbound Reddit traffic through a residential proxy via a `REDDIT_PROXY_URL`
environment variable, and hit it again.

Do not assume either outcome — Reddit blocks the JSON endpoints from
everywhere, but RSS is consumed by hosted feed readers all day. Measure it.

**Environment variables:** `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`,
`AUTH_URL`, `RAPIDAPI_KEY`, `REDDIT_USER_AGENT`, optionally
`REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` and `REDDIT_PROXY_URL`, plus any
OnlyFans/click-tracking keys.

**Keep real account handles out of the repository.** A roster of live usernames
is exactly the list a competitor wants. Put it in a gitignored local file with a
committed `.example`, and keep the repo private regardless.

---

# THINGS TO GET RIGHT THAT ARE EASY TO GET WRONG

1. **Never treat an absence as an answer.** Re-read the rule above. It is the
   single largest source of wrong data in this domain.
2. **One definition of "an account we are running"**, exported as a constant.
3. **Every number on a screen describes the same window.**
4. **`null` in a requirement field means "not read", not "no".**
5. **Show hours under 48**, days after.
6. **Do not sum mod removals and Reddit-filter removals.**
7. **A status must be reversible; a flag is history.**
8. **Warming accounts do their work in comments.** Track comments or they read
   as idle.
9. **Tiers come from slot count, not list length.**
10. **Say what was excluded and why**, in one line, rather than silently
    shortening a list.
