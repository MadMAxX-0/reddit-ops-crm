/** All money is integer cents everywhere in this codebase. */
export function fmtMoney(
  cents: number | null | undefined,
  opts: { precise?: boolean } = {},
): string {
  if (cents == null) return '—'
  const v = cents / 100
  if (opts.precise) return `$${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00')}`
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtMoneyCompact(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const v = cents / 100
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Signed delta string for the metric-card delta row. */
export function fmtDelta(pct: number | null | undefined, digits = 1): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  return `${arrow} ${pct > 0 ? '+' : ''}${(pct * 100).toFixed(digits)}%`
}

export function pctChange(current: number, prior: number): number | null {
  if (!prior) return current ? null : 0
  return (current - prior) / prior
}

export function safeRatio(numerator: number, denominator: number): number | null {
  if (!denominator) return null
  return numerator / denominator
}

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
