import { z } from 'zod'

/**
 * The output contract. The model returns exactly this — strict JSON, no prose
 * wrapper — and it is enforced by the API rather than by hopeful parsing.
 */
export const findingSchema = z.object({
  title: z.string(),
  detail: z.string(),
  severity: z.enum(['info', 'warn', 'critical']),
  /** the key from the supplied context this finding rests on */
  metric: z.string(),
  value: z.number(),
  change_pct: z.number(),
})

export const recommendationSchema = z.object({
  action: z.string(),
  rationale: z.string(),
  expected_impact: z.string(),
  effort: z.enum(['low', 'med', 'high']),
  owner_role: z.enum(['POSTER', 'FARMER', 'MANAGER']),
})

export const reportOutputSchema = z.object({
  headline: z.string(),
  summary_md: z.string(),
  findings: z.array(findingSchema),
  recommendations: z.array(recommendationSchema),
  questions_for_humans: z.array(z.string()),
})

export type ReportOutput = z.infer<typeof reportOutputSchema>
export type Finding = z.infer<typeof findingSchema>
export type Recommendation = z.infer<typeof recommendationSchema>

export const REPORT_KINDS = {
  daily_ops: {
    label: 'Daily ops brief',
    scope: 'GLOBAL' as const,
    cadence: '07:00 workspace time',
    contents: "Yesterday's output, goal attainment, removals, anything needing action today",
  },
  weekly_creator: {
    label: 'Weekly creator report',
    scope: 'CREATOR' as const,
    cadence: 'Monday',
    contents:
      'Posts, reach, landings, subs, revenue, best and worst subreddits, next-week recommendations',
  },
  weekly_va: {
    label: 'Weekly VA review',
    scope: 'VA' as const,
    cadence: 'Monday',
    contents: 'Volume vs goal, quality metrics, trend, coaching notes',
  },
  subreddit_intel: {
    label: 'Subreddit intelligence',
    scope: 'GLOBAL' as const,
    cadence: 'Monthly',
    contents: 'Tier changes, rising and declining subs, removal-rate shifts, suggested additions',
  },
  adhoc: {
    label: 'Ad-hoc',
    scope: 'GLOBAL' as const,
    cadence: 'On demand',
    contents: 'Free-text question answered against the same aggregated context',
  },
} as const

export type ReportKind = keyof typeof REPORT_KINDS
