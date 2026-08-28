import { prisma } from '@/lib/prisma'
import { DEVICES } from '../../../prisma/pipeline-roster'

export interface PipelineQuery {
  stage?: string | null
  device?: string | null
  q?: string
}

export interface PipelineRowDTO {
  id: string
  username: string
  device: string | null
  stage: string
  flag: string
  modelLabel: string | null
  posterName: string | null
  ageDays: number | null
  /// post and comment karma as of the last health check
  karmaPost: number
  karmaComment: number
  lastCheckedAt: Date | null
}

/**
 * Reading the pipeline. Ages are derived here rather than in the page, so the
 * clock is read once per request in plain data code instead of during a
 * component render.
 */
export async function loadPipeline(query: PipelineQuery) {
  const [accounts, stageRows, deviceRows] = await Promise.all([
    prisma.redditAccount.findMany({
      where: {
        status: { not: 'RETIRED' },
        ...(query.stage ? { pipelineStage: query.stage as never } : {}),
        ...(query.device
          ? query.device === 'none'
            ? { device: null }
            : { device: query.device }
          : {}),
        ...(query.q ? { username: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ device: 'asc' }, { username: 'asc' }],
      take: 1000,
      select: {
        id: true,
        username: true,
        device: true,
        pipelineStage: true,
        flag: true,
        redditCreatedAt: true,
        modelLabel: true,
        karmaPost: true,
        karmaComment: true,
        lastCheckedAt: true,
        assignedPoster: { select: { name: true } },
      },
    }),
    prisma.redditAccount.groupBy({
      by: ['pipelineStage'],
      where: { status: { not: 'RETIRED' } },
      _count: { _all: true },
    }),
    prisma.redditAccount.groupBy({
      by: ['device'],
      where: { status: { not: 'RETIRED' } },
      _count: { _all: true },
    }),
  ])

  const now = Date.now()

  const rows: PipelineRowDTO[] = accounts.map((a) => ({
    id: a.id,
    username: a.username,
    device: a.device,
    stage: a.pipelineStage,
    flag: a.flag,
    modelLabel: a.modelLabel,
    posterName: a.assignedPoster?.name ?? null,
    ageDays: a.redditCreatedAt
      ? Math.floor((now - a.redditCreatedAt.getTime()) / 86_400_000)
      : null,
    karmaPost: a.karmaPost,
    karmaComment: a.karmaComment,
    lastCheckedAt: a.lastCheckedAt,
  }))

  return {
    rows,
    stageCounts: Object.fromEntries(stageRows.map((s) => [s.pipelineStage, s._count._all])),
    deviceCounts: Object.fromEntries(deviceRows.map((d) => [d.device ?? 'none', d._count._all])),
    devices: [
      ...new Set([...DEVICES, ...(deviceRows.map((d) => d.device).filter(Boolean) as string[])]),
    ].sort(),
  }
}
