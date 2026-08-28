/**
 * The niche vocabulary watched accounts are filed under.
 *
 * A fixed list rather than free text on purpose: free tags drift into
 * "latina", "Latina" and "latinas" across three accounts within a week, and a
 * filter bar built on drifted tags is worse than no filter at all. It mirrors
 * the taxonomy the team already uses on the X tracker, so the same account
 * means the same thing on both screens.
 *
 * Add to this list to add a tag. Nothing else needs to change.
 */
export const SPY_TAGS = [
  'AI',
  'Asian',
  'Ass',
  'Bikini',
  'Boobs',
  'Caucasian',
  'Cosplay',
  'Curvy / BBW',
  'Girl next door',
  'Goth',
  'Latina',
  'Lingerie',
  'Petite',
  'Sport',
  'Tattooed',
  'Teen (18+)',
  'Trans / TS',
] as const

export type SpyTag = (typeof SPY_TAGS)[number]

/** Anything not in the vocabulary is dropped rather than silently stored. */
export function cleanTags(tags: string[]): string[] {
  const allowed = new Set<string>(SPY_TAGS)
  return [...new Set(tags.filter((t) => allowed.has(t)))]
}
