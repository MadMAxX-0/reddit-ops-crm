import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { prisma } from '@/lib/prisma'
import { getWorkspace } from '@/lib/workspace'
import { AUDIT_ACTIONS, writeAudit } from '@/lib/audit'
import {
  buildReportContext,
  periodFor,
  type Period,
  type ReportContext,
  type ReportScope,
} from './context'
import { KIND_INSTRUCTIONS, SYSTEM_PROMPT } from './prompts'
import { REPORT_KINDS, reportOutputSchema, type ReportKind, type ReportOutput } from './schema'

export const REPORT_MODEL = process.env.REPORT_MODEL ?? 'claude-opus-5'

let client: Anthropic | null = null
function anthropic(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export class ReportUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportUnavailable'
  }
}

export interface GenerateOptions {
  kind: ReportKind
  scopeId?: string | null
  /** ad-hoc only */
  question?: string
  period?: Period
  generatedById?: string | null
}

export async function generateReport(opts: GenerateOptions) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new ReportUnavailable(
      'No Anthropic credentials configured. Set ANTHROPIC_API_KEY to generate reports.',
    )
  }

  const workspace = await getWorkspace()
  const kindDef = REPORT_KINDS[opts.kind]
  const scope: ReportScope = opts.scopeId ? kindDef.scope : 'GLOBAL'
  const period = opts.period ?? periodFor(opts.kind, workspace.dayBoundaryTimezone)

  const context = await buildReportContext(scope, opts.scopeId ?? null, period)

  const userContent = [
    KIND_INSTRUCTIONS[opts.kind],
    opts.question ? `\n\nQuestion from the manager:\n${opts.question}` : '',
    '\n\nCONTEXT (this is everything you know):\n',
    JSON.stringify(context),
  ].join('')

  const response = await anthropic().messages.parse({
    model: REPORT_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: zodOutputFormat(reportOutputSchema),
    },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // the system prompt is byte-identical across every report, so it is the
        // natural cache prefix; the context object goes after it and varies
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
  })

  if (response.stop_reason === 'refusal') {
    throw new ReportUnavailable(
      `The model declined to write this report (${response.stop_details?.category ?? 'unspecified'}).`,
    )
  }

  const output = response.parsed_output as ReportOutput | null
  if (!output) {
    throw new ReportUnavailable('The model returned output that did not match the report schema.')
  }

  // Versioned, never silently regenerated: a re-run for the same scope and
  // period becomes version N+1 alongside the old one rather than replacing it.
  const previous = await prisma.report.findFirst({
    where: { scope, scopeId: opts.scopeId ?? null, kind: opts.kind, periodStart: period.start },
    orderBy: { version: 'desc' },
    select: { version: true },
  })

  const report = await prisma.report.create({
    data: {
      scope,
      scopeId: opts.scopeId ?? null,
      kind: opts.kind,
      periodStart: period.start,
      periodEnd: period.end,
      headline: output.headline,
      summaryMd: output.summary_md,
      findingsJson: {
        findings: output.findings,
        recommendations: output.recommendations,
        questions_for_humans: output.questions_for_humans,
      },
      // stored so any number in the report can be traced back to its source
      contextJson: context as unknown as object,
      generatedById: opts.generatedById ?? null,
      model: REPORT_MODEL,
      version: (previous?.version ?? 0) + 1,
    },
  })

  await writeAudit({
    actorId: opts.generatedById ?? null,
    action: AUDIT_ACTIONS.REPORT_GENERATE,
    entityType: 'Report',
    entityId: report.id,
    after: { kind: opts.kind, scope, scopeId: opts.scopeId ?? null, version: report.version },
  })

  return { report, output, context, usage: response.usage }
}

/**
 * Rebuild the typed output contract from the stored row.
 *
 * headline and summaryMd live in their own columns (they are queried and
 * displayed on the list screen); the rest lives in findingsJson. The columns
 * win, because they are what a later edit or migration would touch.
 */
export function readReport(row: {
  headline?: string | null
  summaryMd?: string | null
  findingsJson: unknown
}): ReportOutput {
  const raw = row.findingsJson as Partial<ReportOutput>
  return {
    headline: row.headline ?? raw.headline ?? '',
    summary_md: row.summaryMd ?? raw.summary_md ?? '',
    findings: raw.findings ?? [],
    recommendations: raw.recommendations ?? [],
    questions_for_humans: raw.questions_for_humans ?? [],
  }
}

export type { ReportContext }
