/**
 * Reads a subreddit's own rules and turns them into the handful of facts that
 * decide whether an account can post there.
 *
 * This is pattern matching over prose written by strangers, so it is wrong
 * sometimes and the design assumes that:
 *
 *  - Every answer is nullable, and null means NOT STATED rather than "no". A
 *    rule the mods never wrote down is a rule we have not read; treating
 *    silence as permission is how accounts get banned.
 *  - The raw rules are stored beside the verdict, so any judgement can be
 *    checked against the sentence it came from.
 *  - Nothing here bans a subreddit by itself. It fills a column; a person
 *    decides.
 */

export interface SubredditRule {
  short_name?: string
  description?: string
  violation_reason?: string
}

export interface ReadRules {
  minKarma: number | null
  minAccountAgeDays: number | null
  requiresVerification: boolean | null
  originalContentOnly: boolean | null
  bansAskingForUpvotes: boolean | null
}

const has = (text: string, ...needles: (string | RegExp)[]) =>
  needles.some((n) => (typeof n === 'string' ? text.includes(n) : n.test(text)))

/**
 * "100 combined karma", "minimum 50 post karma", "at least 250 karma".
 * Deliberately narrow: a number must sit next to the word karma, otherwise
 * "karma is not everything" would be read as a threshold of nothing.
 */
function karmaFloor(text: string): number | null {
  const hits = [
    ...text.matchAll(/(\d[\d,]*)\s*\+?\s*(?:combined\s+|comment\s+|post\s+|link\s+)?karma/g),
    ...text.matchAll(/karma\s*(?:requirement|minimum|of|:)?\s*(?:is\s*)?(\d[\d,]*)/g),
  ]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100_000)
  return hits.length ? Math.max(...hits) : null
}

/** "account must be 30 days old", "7 day old accounts". */
function ageFloor(text: string): number | null {
  const hits = [
    ...text.matchAll(/(\d+)\s*(?:\+)?\s*(day|week|month)s?\s*(?:\+)?\s*old/g),
    ...text.matchAll(/account\s+(?:age|must be)\D{0,20}?(\d+)\s*(day|week|month)/g),
  ]
    .map((m) => {
      const n = Number(m[1])
      const unit = m[2]
      return unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n
    })
    .filter((n) => Number.isFinite(n) && n > 0 && n < 3650)
  return hits.length ? Math.max(...hits) : null
}

export function readRules(rules: SubredditRule[]): ReadRules {
  if (!rules.length) {
    return {
      minKarma: null,
      minAccountAgeDays: null,
      requiresVerification: null,
      originalContentOnly: null,
      bansAskingForUpvotes: null,
    }
  }

  const text = rules
    .map((r) => `${r.short_name ?? ''} ${r.description ?? ''} ${r.violation_reason ?? ''}`)
    .join('\n')
    .toLowerCase()

  return {
    minKarma: karmaFloor(text),
    minAccountAgeDays: ageFloor(text),

    // "verification" on a NSFW sub means the photo-with-a-sign process, which
    // is a real cost per account and the single most useful thing to know
    requiresVerification: has(text, 'verif') ? true : null,

    // OC rules are phrased a dozen ways; "of yourself" is the one that actually
    // catches the NSFW subs, where the rule is about who is in the picture
    originalContentOnly: has(
      text,
      'original content',
      'oc only',
      'no repost',
      'reposts are not',
      'do not steal',
      'don`t steal',
      "don't steal",
      'content of yourself',
      'pictures and videos of yourself',
      'photos of yourself',
      // r/FemBoys (2.7M) states it as "Only post photos or videos of yourself"
      // and "All posts must be made by the person in the photo / video" —
      // neither matched, so the largest sub on the list read as having no OC
      // rule at all. These are the phrasings that were slipping through.
      'videos of yourself',
      'video of yourself',
      'photos or videos of yourself',
      'must be made by the person',
      'must be the person in the',
      'you must be in the',
      'only yourself',
      'post yourself',
      'selfies only',
      'self-posts only',
      'self posts only',
    )
      ? true
      : null,

    bansAskingForUpvotes: has(
      text,
      'asking for upvotes',
      'ask for upvotes',
      'vote manipulation',
      'upvote begging',
      'begging for upvotes',
      'clickbait',
      'click bait',
      'baiting',
      'misleading title',
    )
      ? true
      : null,
  }
}
