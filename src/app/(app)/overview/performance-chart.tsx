'use client'

import * as React from 'react'
import { Area, ComposedChart, Line, ResponsiveContainer } from 'recharts'
import { ChartCard } from '@/components/ui/chart-card'
import { EmptyState } from '@/components/ui/empty-state'
import { AreaGradient, CHART_COLORS, DarkTooltip, Grid, XA, YA } from '@/components/ui/chart-theme'
import { fmtCompact, fmtMoney, fmtMoneyCompact, fmtNum } from '@/lib/format'
import { fmtTs } from '@/lib/time'

/**
 * Posts and revenue on one dual-axis chart. Posts are the orange series
 * because posts are the thing being measured; revenue rides the second axis in
 * info-blue so the two never read as competing accents.
 */
const GRANULARITY_LABEL = { hour: 'hourly', day: 'daily', week: 'weekly' } as const

export function PerformanceChart({
  points,
  granularity,
  displayTz,
  className,
}: {
  points: Array<{
    bucket: Date
    posts: number
    removed: number
    landings: number
    revenueCents: number
  }>
  granularity: 'hour' | 'day' | 'week'
  displayTz: string
  className?: string
}) {
  const data = points.map((p) => ({
    ts: new Date(p.bucket).getTime(),
    posts: p.posts,
    removed: p.removed,
    landings: p.landings,
    revenue: p.revenueCents / 100,
  }))

  const label = (v: number) => {
    const d = new Date(v)
    if (granularity === 'hour') return fmtTs(d, displayTz).slice(5, 16)
    return d.toISOString().slice(5, 10)
  }

  return (
    <ChartCard
      title="Performance over time"
      right={<span className="sublabel">{GRANULARITY_LABEL[granularity]} · posts and revenue</span>}
      className={className}
    >
      {data.length < 2 ? (
        <EmptyState title="Not enough data in this window to plot a trend." />
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <AreaGradient id="ovPosts" color={CHART_COLORS.accent} />
              </defs>
              <Grid />
              <XA
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={label}
              />
              <YA yAxisId="posts" tickFormatter={(v: number) => fmtCompact(v)} />
              <YA
                yAxisId="revenue"
                orientation="right"
                tickFormatter={(v: number) => fmtMoneyCompact(v * 100)}
              />
              <DarkTooltip
                labelFormatter={(v) => label(Number(v))}
                formatter={(v, n) =>
                  n === 'revenue'
                    ? [fmtMoney(Number(v) * 100), 'Revenue']
                    : [
                        fmtNum(Number(v)),
                        n === 'posts' ? 'Posts' : n === 'removed' ? 'Removed' : 'Landings',
                      ]
                }
              />
              <Area
                yAxisId="posts"
                type="monotone"
                dataKey="posts"
                stroke={CHART_COLORS.accent}
                fill="url(#ovPosts)"
                strokeWidth={1.75}
              />
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                stroke={CHART_COLORS.info}
                strokeWidth={1.75}
                dot={false}
              />
              <Line
                yAxisId="posts"
                type="monotone"
                dataKey="removed"
                stroke={CHART_COLORS.negative}
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="text-fg-muted text-13 flex flex-wrap items-center gap-4 px-3 pt-1">
        <Swatch color={CHART_COLORS.accent} label="Posts" />
        <Swatch color={CHART_COLORS.info} label="Revenue" />
        <Swatch color={CHART_COLORS.negative} label="Removed" dashed />
      </div>
    </ChartCard>
  )
}

function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-0.5 w-4"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`
            : color,
        }}
      />
      {label}
    </span>
  )
}
