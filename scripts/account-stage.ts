/**
 * Move accounts between pipeline stages.
 *   npm run accounts:stage                          -- show the split
 *   npm run accounts:stage -- --farming u/a,u/b     -- out of rotation
 *   npm run accounts:stage -- --active u/a          -- into rotation
 *   npm run accounts:stage -- --creating u/a
 *
 * Stage drives what the dashboard counts: only ACTIVE accounts are treated as
 * promotion, and everything an ACTIVE account posts is counted as its output.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import type { PipelineStage } from '../src/generated/prisma/client'

function names(flag: string): string[] {
  const i = process.argv.indexOf(flag)
  if (i === -1) return []
  return (process.argv[i + 1] ?? '')
    .split(',')
    .map((n) => n.trim().replace(/^\/?u\//i, ''))
    .filter(Boolean)
}

async function main() {
  const moves: Array<[string, PipelineStage]> = [
    ['--active', 'ACTIVE'],
    ['--farming', 'FARMING'],
    ['--creating', 'CREATING'],
  ]
  for (const [flag, stage] of moves) {
    const list = names(flag)
    if (!list.length) continue
    const rows = await prisma.redditAccount.findMany({
      where: { OR: list.map((n) => ({ username: { equals: n, mode: 'insensitive' as const } })) },
      select: { id: true, username: true },
    })
    await prisma.redditAccount.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { pipelineStage: stage },
    })
    const found = new Set(rows.map((r) => r.username.toLowerCase()))
    const missing = list.filter((n) => !found.has(n.toLowerCase()))
    console.log(
      `${stage}: ${rows.map((r) => 'u/' + r.username).join(', ') || 'none'}` +
        (missing.length ? ` · not found: ${missing.join(', ')}` : ''),
    )
  }

  const g = await prisma.redditAccount.groupBy({ by: ['pipelineStage'], _count: true })
  console.log('\nstages:', g.map((x) => `${x.pipelineStage}=${x._count}`).join('  '))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
