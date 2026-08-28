import { cache } from 'react'
import { prisma } from '@/lib/prisma'

/**
 * Workspace settings are read on essentially every request (the day-boundary
 * timezone drives all aggregation), so it is cached per request.
 */
export const getWorkspace = cache(async () => {
  const existing = await prisma.workspace.findFirst()
  if (existing) return existing
  return prisma.workspace.create({
    data: {
      name: process.env.WORKSPACE_NAME ?? 'Workspace',
      dayBoundaryTimezone: process.env.WORKSPACE_DAY_BOUNDARY_TZ ?? 'UTC',
      funnelBaseUrl: process.env.FUNNEL_BASE_URL ?? 'http://localhost:3000/f',
    },
  })
})
