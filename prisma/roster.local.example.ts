/**
 * Copy to `roster.local.ts` and fill in. Seeding the pipeline reads it; the
 * app runs fine without it, with an empty pipeline.
 */
import type { PipelineRow } from './pipeline-roster'

const F = 'FARMING' as const
const C = 'CREATING' as const

export const PIPELINE: PipelineRow[] = [
  { username: 'example_account', device: 'Phone 1', ageDays: 30, stage: F, flag: 'NONE' },
  { username: 'another_one', device: null, ageDays: null, stage: C, flag: 'NONE' },
]
