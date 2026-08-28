import { SimulatedOnlyFansProvider } from './simulated'
import type { OnlyFansProvider } from './types'

export * from './types'

let cached: OnlyFansProvider | null = null

/**
 * Only the simulated provider ships today. A real implementation drops in here
 * unchanged as long as it can answer "what happened, and which tracking link
 * was it attributed to" — that second half is the whole reason we mint one
 * tracking link per Reddit account.
 */
export function onlyFansProvider(): OnlyFansProvider {
  if (!cached) cached = new SimulatedOnlyFansProvider()
  return cached
}
