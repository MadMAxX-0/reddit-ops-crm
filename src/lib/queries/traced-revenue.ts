import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Revenue traced to a traffic source fan by fan — no ratios.
 *
 * OnlyFans records which tracking link each fan came through ("claimers") and
 * records every payment against the fan who made it. Joining the two says, for
 * an actual dollar, which link brought the person who spent it.
 *
 * ATTRIBUTION RULE: a fan belongs to every link they claimed. If Reddit brought
 * a fan, that fan's spending is Reddit's — for good, not until they happen to
 * touch another link. An earlier version of this file used last-touch, which
 * quietly handed years of Reddit fans to whichever link they clicked most
 * recently and halved Reddit's figure. This rule reproduces the panel's own
 * per-link earnings exactly.
 *
 * The rule can in principle count one fan under two links. In practice the
 * overlap is negligible here, and `sharedWithOtherLinkCents` reports it rather
 * than leaving it to be discovered.
 *
 * Every payment in the window counts, whenever the fan arrived: a fan Reddit
 * brought in months ago who tips today is Reddit's money today. The figures
 * split by arrival — inside the window or before it — because those answer
 * different questions: what this period's posting brought in, and what the back
 * catalogue still earns.
 *
 * What this cannot do is invent coverage. A fan who arrived through no link is
 * in nobody's list; those payments come back as `untracedCents` and are never
 * quietly spread across the links that are known.
 */

/**
 * Which fans to count. A fan is "new" to a window if they subscribed inside it
 * and "returning" if they subscribed before — so `returning` isolates what
 * earlier work is still earning, and `new` isolates what this period brought in
 * on its own.
 *
 * The date comes from the subscriber record, not from the claim row. A claim
 * carries the date the platform cache first SAW the fan, and whole links land
 * on a single backfill day, so splitting on it would measure when we started
 * looking rather than when anyone arrived.
 *
 * Fans who subscribed, spent and then churned drop out of the subscriber list
 * entirely, so they have no date at all. Their first payment stands in — they
 * are among the newest fans there are, and defaulting them to "returning" was
 * quietly moving this period's own winnings into the back catalogue.
 */
export type FanFilter = 'all' | 'new' | 'returning'

/** SQL for a fan filter, given the window start. */
function fanClause(fans: FanFilter, start: Date): Prisma.Sql {
  if (fans === 'new') return Prisma.sql`AND arrived_at >= ${start}`
  if (fans === 'returning') return Prisma.sql`AND (arrived_at IS NULL OR arrived_at < ${start})`
  return Prisma.empty
}

/**
 * The same filter where there is no `arrived_at` column to hand — the fan's
 * first claim on a tracked link, computed inline.
 */
function fanClauseInline(fans: FanFilter, start: Date): Prisma.Sql {
  if (fans === 'all') return Prisma.empty
  const arrived = Prisma.sql`COALESCE(
    (SELECT f."subscribedAt" FROM "OfFan" f
      WHERE f."ofUserId" = t."ofUserId" AND f."fanId" = t."fanId"),
    (SELECT MIN(t2.ts) FROM "OfTransaction" t2
      WHERE t2."ofUserId" = t."ofUserId" AND t2."fanId" = t."fanId")
  )`
  return fans === 'new'
    ? Prisma.sql`AND ${arrived} >= ${start}`
    : Prisma.sql`AND (${arrived} IS NULL OR ${arrived} < ${start})`
}

/** Tags each payment with the sources its fan came through. */
function tagged(start: Date, end: Date, scope: Prisma.Sql) {
  return Prisma.sql`
    SELECT t."ofUserId", t."fanId", t."netCents", t.ts,
           EXISTS (
             SELECT 1 FROM "OfFanClaim" fc
             JOIN "OfCampaign" c ON c.id = fc."campaignId"
             WHERE fc."ofUserId" = t."ofUserId" AND fc."fanId" = t."fanId"
               AND c."trackedInCrm"
           ) AS reddit,
           EXISTS (
             SELECT 1 FROM "OfFanClaim" fc
             JOIN "OfCampaign" c ON c.id = fc."campaignId"
             WHERE fc."ofUserId" = t."ofUserId" AND fc."fanId" = t."fanId"
               AND NOT c."trackedInCrm"
           ) AS other,
           COALESCE(
             (
               SELECT f."subscribedAt" FROM "OfFan" f
               WHERE f."ofUserId" = t."ofUserId" AND f."fanId" = t."fanId"
             ),
             (
               SELECT MIN(t2.ts) FROM "OfTransaction" t2
               WHERE t2."ofUserId" = t."ofUserId" AND t2."fanId" = t."fanId"
             )
           ) AS arrived_at
    FROM "OfTransaction" t
    WHERE t.ts >= ${start} AND t.ts < ${end} ${scope}
  `
}

export interface TracedRevenue {
  redditCents: number
  /** of the Reddit money: from fans who arrived inside this window */
  redditNewFanCents: number
  /** and from fans Reddit brought in earlier, still spending */
  redditReturningFanCents: number
  redditNewFans: number
  redditReturningFans: number
  /** Reddit money from fans who also came through a non-Reddit link */
  sharedWithOtherLinkCents: number
  otherLinkCents: number
  untracedCents: number
  totalCents: number
  transactions: number
  redditTransactions: number
  /** share of the period's money that could be traced to any link at all */
  coverage: number | null
}

export async function tracedRevenue(
  start: Date,
  end: Date,
  opts: { ofUserIds?: string[]; fans?: FanFilter } = {},
): Promise<TracedRevenue> {
  const { ofUserIds, fans = 'all' } = opts
  const scope = ofUserIds?.length ? Prisma.sql`AND t."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  const keep = fanClause(fans, start)

  const rows = await prisma.$queryRaw<
    Array<{
      reddit: bigint
      reddit_new: bigint
      reddit_old: bigint
      new_fans: bigint
      old_fans: bigint
      shared: bigint
      other: bigint
      untraced: bigint
      total: bigint
      txs: bigint
      reddit_txs: bigint
    }>
  >(Prisma.sql`
    WITH base AS (${tagged(start, end, scope)}),
    tx AS (SELECT *, (TRUE ${keep}) AS kept FROM base)
    SELECT COALESCE(SUM("netCents") FILTER (WHERE reddit AND kept), 0) AS reddit,
           COALESCE(SUM("netCents") FILTER (WHERE reddit AND arrived_at >= ${start}), 0) AS reddit_new,
           COALESCE(SUM("netCents") FILTER (WHERE reddit AND (arrived_at IS NULL OR arrived_at < ${start})), 0) AS reddit_old,
           COUNT(DISTINCT "fanId") FILTER (WHERE reddit AND arrived_at >= ${start}) AS new_fans,
           COUNT(DISTINCT "fanId") FILTER (WHERE reddit AND (arrived_at IS NULL OR arrived_at < ${start})) AS old_fans,
           COALESCE(SUM("netCents") FILTER (WHERE reddit AND other AND kept), 0) AS shared,
           COALESCE(SUM("netCents") FILTER (WHERE other AND NOT reddit), 0) AS other,
           COALESCE(SUM("netCents") FILTER (WHERE NOT reddit AND NOT other), 0) AS untraced,
           COALESCE(SUM("netCents"), 0) AS total,
           COUNT(*) AS txs,
           COUNT(*) FILTER (WHERE reddit AND kept) AS reddit_txs
    FROM tx
  `)

  const r = rows[0]
  const total = Number(r?.total ?? 0)
  const untraced = Number(r?.untraced ?? 0)

  return {
    redditCents: Number(r?.reddit ?? 0),
    redditNewFanCents: Number(r?.reddit_new ?? 0),
    redditReturningFanCents: Number(r?.reddit_old ?? 0),
    redditNewFans: Number(r?.new_fans ?? 0),
    redditReturningFans: Number(r?.old_fans ?? 0),
    sharedWithOtherLinkCents: Number(r?.shared ?? 0),
    otherLinkCents: Number(r?.other ?? 0),
    untracedCents: untraced,
    totalCents: total,
    transactions: Number(r?.txs ?? 0),
    redditTransactions: Number(r?.reddit_txs ?? 0),
    coverage: total ? (total - untraced) / total : null,
  }
}

/**
 * Traced revenue per Reddit account: what the fans who came through that
 * account's own tracking link have spent in the window.
 */
export async function tracedByRedditAccount(start: Date, end: Date, fans: FanFilter = 'all') {
  const rows = await prisma.$queryRaw<
    Array<{ reddit_account_id: string; cents: bigint }>
  >(Prisma.sql`
    SELECT c."redditAccountId" AS reddit_account_id,
           COALESCE(SUM(spend.cents), 0) AS cents
    FROM "OfCampaign" c
    JOIN LATERAL (
      SELECT COALESCE(SUM(t."netCents"), 0) AS cents
      FROM "OfTransaction" t
      WHERE t.ts >= ${start} AND t.ts < ${end}
        AND t."ofUserId" = c."ofUserId"
        AND EXISTS (
          SELECT 1 FROM "OfFanClaim" fc
          WHERE fc."campaignId" = c.id AND fc."fanId" = t."fanId" AND fc."ofUserId" = t."ofUserId"
        )
        ${fanClauseInline(fans, start)}
    ) spend ON TRUE
    WHERE c."redditAccountId" IS NOT NULL AND NOT c."isDeleted"
    GROUP BY 1
  `)
  return new Map(rows.map((r) => [r.reddit_account_id, Number(r.cents)]))
}

/** Traced Reddit revenue per day, for the dashboard chart. */
export async function tracedRedditSeries(
  start: Date,
  end: Date,
  fans: FanFilter = 'all',
  ofUserIds?: string[],
) {
  const scope = ofUserIds?.length ? Prisma.sql`AND t."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ day: Date; cents: bigint }>>(Prisma.sql`
    WITH tx AS (${tagged(start, end, scope)})
    SELECT (ts AT TIME ZONE 'UTC')::date AS day, COALESCE(SUM("netCents"), 0) AS cents
    FROM tx WHERE reddit ${fanClause(fans, start)}
    GROUP BY 1 ORDER BY 1
  `)
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), cents: Number(r.cents) }))
}

/**
 * Traced revenue per link. A fan who claimed two links is counted under both,
 * exactly as the OnlyFans panel reports it — so these rows do not sum to the
 * Reddit total, and are for comparing links against each other.
 */
export async function tracedByCampaign(start: Date, end: Date) {
  const rows = await prisma.$queryRaw<
    Array<{ campaign_id: string; cents: bigint; spenders: bigint }>
  >(Prisma.sql`
    SELECT c.id AS campaign_id, COALESCE(spend.cents, 0) AS cents, COALESCE(spend.spenders, 0) AS spenders
    FROM "OfCampaign" c
    JOIN LATERAL (
      SELECT COALESCE(SUM(t."netCents"), 0) AS cents,
             COUNT(DISTINCT t."fanId") AS spenders
      FROM "OfTransaction" t
      WHERE t.ts >= ${start} AND t.ts < ${end}
        AND t."ofUserId" = c."ofUserId"
        AND EXISTS (
          SELECT 1 FROM "OfFanClaim" fc
          WHERE fc."campaignId" = c.id AND fc."fanId" = t."fanId" AND fc."ofUserId" = t."ofUserId"
        )
    ) spend ON TRUE
    WHERE NOT c."isDeleted"
  `)
  return new Map(
    rows.map((r) => [r.campaign_id, { cents: Number(r.cents), spenders: Number(r.spenders) }]),
  )
}

/**
 * Subscribers Reddit brought in during a window — counted, not diffed.
 *
 * A link's own counter is a lifetime running total, so a window figure from it
 * needs two readings and cannot describe a period that began before the first
 * one. This instead counts the fans themselves: everyone who claimed a counted
 * link and whose subscribe date falls inside the window. It works for any
 * window, including ones that predate the CRM.
 *
 * A fan is counted once even if they claimed several links.
 */
/**
 * Counting from the claim side rather than the subscriber side, because fans who
 * subscribe and then churn are dropped from the subscriber list entirely —
 * 202 of one link's 1,341 fans, 131 of them from inside the last month. Count
 * only the fans still listed and a link that converts and loses them looks like
 * a link that never converted.
 *
 * Arrival is the platform's subscribe date, taken from the claimer row first
 * (it survives a fan churning) and the subscriber list second. Fans with
 * neither are not counted at all: their OnlyFans accounts have been deleted,
 * the date is gone from the platform, and the claim date is a backfill batch —
 * hundreds stamped on one day — so counting them by it invents arrivals in
 * whichever window the batch happened to land in.
 */
/**
 * When a fan arrived, best source first.
 *
 * OnlyMonster leads because it logged arrivals as they happened and still holds
 * fans whose OnlyFans accounts have since been deleted — OnlyFans answers "User
 * not found" for those, so nothing on the platform can date them. The claimer
 * row comes next (it survives a fan churning off the subscriber list), then the
 * subscriber list itself.
 *
 * Both sources feed one list rather than one being joined onto the other: a fan
 * OnlyMonster recorded but OnlyFans' claimer list has since dropped belongs in
 * the count, and joining through the claimer list would silently lose them.
 */
/**
 * Every arrival on a counted link, optionally narrowed to one model.
 *
 * The scope is applied to the CAMPAIGN, not to the fan: a link belongs to
 * exactly one OnlyFans account, so filtering there is what "this model's
 * traffic" means. Filtering on the fan would follow a person who subscribed to
 * two models into both.
 */
const arrivals = (ofUserIds?: string[]) => {
  const scope = ofUserIds?.length ? Prisma.sql`AND c."ofUserId" = ANY(${ofUserIds})` : Prisma.empty
  return Prisma.sql`
  SELECT campaign_id, reddit_account_id, fan_id,
         COALESCE(MIN(om_arrived), MIN(other_arrived)) AS arrived
  FROM (
    SELECT c.id AS campaign_id, c."redditAccountId" AS reddit_account_id,
           om."fanId" AS fan_id, om."subscribedAt" AS om_arrived,
           NULL::timestamp AS other_arrived
    FROM "OmLinkFan" om
    JOIN "OfCampaign" c ON c."ofCampaignId" = om."linkId"
    WHERE c."trackedInCrm" ${scope}
    UNION ALL
    SELECT c.id, c."redditAccountId", fc."fanId", NULL::timestamp,
           COALESCE(fc."subscribedAt", f."subscribedAt")
    FROM "OfFanClaim" fc
    JOIN "OfCampaign" c ON c.id = fc."campaignId"
    LEFT JOIN "OfFan" f ON f."ofUserId" = fc."ofUserId" AND f."fanId" = fc."fanId"
    WHERE c."trackedInCrm" ${scope}
  ) src
  GROUP BY 1, 2, 3
`
}

export async function redditSubs(start: Date, end: Date, ofUserIds?: string[]): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    WITH arrivals AS (${arrivals(ofUserIds)})
    SELECT COUNT(DISTINCT fan_id) AS n FROM arrivals
    WHERE arrived >= ${start} AND arrived < ${end}
  `)
  return Number(rows[0]?.n ?? 0)
}

/** The same count per Reddit account, for the per-account table. */
export async function redditSubsByAccount(start: Date, end: Date, ofUserIds?: string[]) {
  const rows = await prisma.$queryRaw<Array<{ reddit_account_id: string; n: bigint }>>(Prisma.sql`
    WITH arrivals AS (${arrivals(ofUserIds)})
    SELECT reddit_account_id, COUNT(DISTINCT fan_id) AS n
    FROM arrivals
    WHERE arrived >= ${start} AND arrived < ${end} AND reddit_account_id IS NOT NULL
    GROUP BY 1
  `)
  return new Map(rows.map((r) => [r.reddit_account_id, Number(r.n)]))
}

/** And per day, for the chart. */
export async function redditSubsSeries(start: Date, end: Date, ofUserIds?: string[]) {
  const rows = await prisma.$queryRaw<Array<{ day: Date; n: bigint }>>(Prisma.sql`
    WITH arrivals AS (${arrivals(ofUserIds)})
    SELECT (arrived AT TIME ZONE 'UTC')::date AS day, COUNT(DISTINCT fan_id) AS n
    FROM arrivals
    WHERE arrived >= ${start} AND arrived < ${end}
    GROUP BY 1 ORDER BY 1
  `)
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), n: Number(r.n) }))
}

/** How fresh the subscriber list is — a window newer than this is under-counted. */
export async function subscriberDataThrough(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ ts: Date | null }>>(Prisma.sql`
    SELECT MAX("subscribedAt") AS ts FROM "OfFan"
  `)
  return rows[0]?.ts ?? null
}

/**
 * How much of a window's subscriber count rests on a claim date rather than a
 * real subscribe date.
 *
 * Claim dates arrive in backfill batches — hundreds stamped on one day — so
 * every fan counted through one is a fan who might belong to an earlier window.
 * The dashboard says how many rather than presenting the total as exact.
 */
export async function redditSubsDated(start: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ exact: bigint }>>(Prisma.sql`
    WITH arrivals AS (${arrivals()})
    SELECT COUNT(DISTINCT fan_id) AS exact FROM arrivals
    WHERE arrived >= ${start} AND arrived < ${end}
  `)
  return { exact: Number(rows[0]?.exact ?? 0), fromClaimDate: 0 }
}
