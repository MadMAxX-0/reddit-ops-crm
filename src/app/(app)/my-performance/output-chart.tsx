'use client'

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer } from 'recharts'
import { ChartCard } from '@/components/ui/chart-card'
import { EmptyState } from '@/components/ui/empty-state'
import { CHART_COLORS, DarkTooltip, Grid, XA, YA } from '@/components/ui/chart-theme'
import type { DayPoint } from '@/lib/queries/scorecard'

/**
 * Daily output against goal. Bars that met the goal go info-blue and bars that
 * missed stay orange — the same rule the goal bars use, so "orange means still
 * short" reads the same way everywhere in the product.
 */
export function OutputChart({ points, role }: { points: DayPoint[]; role: 'POSTER' | 'FARMER' }) {
  const data = points.map((p) => ({
    day: p.day.slice(5),
    value: p.value,
    goal: p.goal,
    met: p.met,
    removed: p.removed,
  }))
  const goal = points[0]?.goal ?? 0

  return (
    <ChartCard
      title="Daily output"
      right={
        <span className="sublabel">
          30 days · {role === 'FARMER' ? 'accounts made' : 'posts discovered'}
        </span>
      }
    >
      {data.every((d) => d.value === 0) ? (
        <EmptyState title="No output recorded in the last 30 days." />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <Grid />
              <XA dataKey="day" interval={2} />
              <YA allowDecimals={false} />
              <DarkTooltip
                formatter={(v, n) => [
                  String(v),
                  n === 'value' ? (role === 'FARMER' ? 'Made' : 'Posts') : 'Failed',
                ]}
              />
              {goal > 0 && (
                <ReferenceLine
                  y={goal}
                  stroke={CHART_COLORS.muted}
                  strokeDasharray="3 3"
                  label={{
                    value: `goal ${goal}`,
                    fill: CHART_COLORS.muted,
                    fontSize: 10,
                    position: 'right',
                  }}
                />
              )}
              <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.met ? CHART_COLORS.info : CHART_COLORS.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
