/**
 * Per-domain token bucket with jittered backoff.
 *
 * The polling budget is the real constraint on discovery, so the limiter is
 * shared process-wide rather than per-job: five jobs each politely doing 30
 * req/min is still 150 req/min at Reddit's door.
 */
export class DomainLimiter {
  private tokens: number
  private lastRefill = Date.now()
  private penaltyUntil = 0

  constructor(
    readonly domain: string,
    private ratePerMin: number,
    private burst = Math.max(1, Math.ceil(ratePerMin / 4)),
  ) {
    this.tokens = this.burst
  }

  setRate(ratePerMin: number) {
    this.ratePerMin = ratePerMin
    this.burst = Math.max(1, Math.ceil(ratePerMin / 4))
  }

  /** Called on a 429 or a 5xx — everything on this domain waits it out. */
  penalise(ms: number) {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms)
  }

  private refill() {
    const now = Date.now()
    const elapsedMin = (now - this.lastRefill) / 60_000
    if (elapsedMin <= 0) return
    this.tokens = Math.min(this.burst, this.tokens + elapsedMin * this.ratePerMin)
    this.lastRefill = now
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now()
      if (now < this.penaltyUntil) {
        await sleep(this.penaltyUntil - now + jitter(500))
        continue
      }
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      // wait for roughly one token, plus jitter so parallel workers desynchronise
      await sleep(60_000 / this.ratePerMin + jitter(250))
    }
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}

export function jitter(maxMs: number) {
  return Math.random() * maxMs
}

/** Exponential backoff with full jitter, capped. */
export function backoffMs(attempt: number, baseMs = 1000, capMs = 60_000) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt)
  return jitter(exp)
}

const limiters = new Map<string, DomainLimiter>()

export function limiterFor(domain: string, ratePerMin: number): DomainLimiter {
  const existing = limiters.get(domain)
  if (existing) {
    existing.setRate(ratePerMin)
    return existing
  }
  const created = new DomainLimiter(domain, ratePerMin)
  limiters.set(domain, created)
  return created
}
