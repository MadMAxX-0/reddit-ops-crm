'use client'

import { CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

/**
 * Shared Recharts styling so every chart reads as one system: no vertical
 * gridlines, faint horizontal ones, axes in muted mono, tooltip on the surface
 * tokens.
 *
 * Tuned for the dark ground. A grid line bright enough to read on white is a
 * fence across a black page, so it sits barely above the surface and the ink
 * goes to the data instead.
 */
export const CHART_COLORS = {
  accent: '#FF7A3D',
  info: '#4D8DFF',
  /** a lighter sibling of `info`, for the top of an area wash */
  infoTint: '#9DBEFF',
  infoSoft: '#37507F',
  positive: '#2ECC71',
  violet: '#A78BFA',
  negative: '#FF5C52',
  warning: '#F5A623',
  grid: 'rgba(255, 255, 255, 0.07)',
  axis: 'rgba(255, 255, 255, 0.12)',
  muted: '#7C828E',
}

const axisTick = {
  fill: CHART_COLORS.muted,
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
}

export function Grid() {
  return <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
}

/**
 * The line every metric chart draws: a soft fill under a 2px stroke, with the
 * end point marked. The fill is what makes a single line read as a quantity
 * rather than as a squiggle.
 */
export const AREA_PROPS = {
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4, strokeWidth: 2 },
} as const

export function XA(props: React.ComponentProps<typeof XAxis>) {
  return (
    <XAxis
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: CHART_COLORS.axis }}
      dy={4}
      minTickGap={24}
      {...props}
    />
  )
}

export function YA(props: React.ComponentProps<typeof YAxis>) {
  // 48 clipped the widest labels — '$2,000' at 13px does not fit, and Recharts
  // truncates rather than overflowing, so the axis silently lied.
  return <YAxis tick={axisTick} tickLine={false} axisLine={false} width={68} {...props} />
}

export function DarkTooltip(props: React.ComponentProps<typeof Tooltip>) {
  return (
    <Tooltip
      cursor={{ stroke: 'rgba(255,255,255,0.22)', strokeWidth: 1 }}
      contentStyle={{
        background: '#191A1D',
        border: '1px solid #2A2C31',
        borderRadius: 8,
        fontSize: 14,
        padding: '8px 10px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
      }}
      labelStyle={{ color: '#D6DAE2', fontSize: 13, marginBottom: 4 }}
      itemStyle={{
        color: '#FFFFFF',
        fontSize: 14,
        fontFamily: 'var(--font-sans)',
        padding: 0,
      }}
      {...props}
    />
  )
}

/**
 * The wash under a trend line: the line's own colour, spread beneath it and
 * fading out.
 *
 * `tint` is a lighter sibling of the line colour used for the top stop. On a
 * black ground a colour at low opacity goes dark rather than pale — it reads as
 * a shadow under the line instead of a glow of the same hue — so the top of the
 * gradient is lightened before it is faded.
 */
export function AreaGradient({ id, color, tint }: { id: string; color: string; tint?: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={tint ?? color} stopOpacity={0.5} />
      <stop offset="35%" stopColor={color} stopOpacity={0.26} />
      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
    </linearGradient>
  )
}
