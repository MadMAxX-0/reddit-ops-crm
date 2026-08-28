import crypto from 'node:crypto'

/** Deterministic PRNG so two runs of the seed produce the same database. */
export function makeRng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    /** picks with weights; weights need not sum to 1 */
    weighted: <T>(entries: readonly (readonly [T, number])[]): T => {
      const total = entries.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [v, w] of entries) {
        r -= w
        if (r <= 0) return v
      }
      return entries[entries.length - 1][0]
    },
    chance: (p: number) => next() < p,
    /** roughly normal via central limit, clamped */
    gauss: (mean: number, sd: number, min = -Infinity, max = Infinity) => {
      const g = (next() + next() + next() + next() + next() + next() - 3) / Math.sqrt(0.5)
      return Math.min(max, Math.max(min, mean + g * sd))
    },
    shuffle: <T>(arr: T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}

export type Rng = ReturnType<typeof makeRng>

let idCounter = 0
const idPrefix = crypto.randomBytes(4).toString('hex')

/** Cheap collision-free ids so createMany can build the whole graph offline. */
export function id(): string {
  idCounter += 1
  return `s${idPrefix}${idCounter.toString(36).padStart(7, '0')}`
}

/** Nothing the seed generates may land in the future — a "created 3 hours from
 *  now" row makes every daily counter and every chart quietly wrong. */
export function clampPast(d: Date): Date {
  const now = Date.now()
  return d.getTime() > now ? new Date(now - 60_000) : d
}

export function daysAgo(n: number, jitterMs = 0): Date {
  return clampPast(new Date(Date.now() - n * 86_400_000 + jitterMs))
}

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000)
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000)
}

/** Insert in chunks — one 70k-row createMany will blow the parameter limit. */
export async function chunked<T>(
  rows: T[],
  size: number,
  fn: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size))
  }
}
