/**
 * The farming pipeline as it stands today, transcribed from the team's own
 * screens. Age is in days; null means the screen showed "—".
 */
export interface PipelineRow {
  username: string
  device: string | null
  ageDays: number | null
  stage: 'CREATING' | 'FARMING'
  flag: 'NONE' | 'BANNED'
}

const F = 'FARMING' as const
const C = 'CREATING' as const

/**
 * The roster itself lives in `roster.local.ts`, which is gitignored: it is a
 * list of live account handles, and a public repo is the last place it should
 * be. Everything here is safe to commit.
 */
export const DEVICES = [
  'Adspower/Chile',
  'Adspower/Italy',
  'Adspower/USA',
  'Iphone 13',
  'Phone 3',
  'Phone 4',
  'Phone 12',
  'Phone 14/Brazil',
]
