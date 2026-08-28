import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ofDestination, readSignals, recordOutbound, resolveMissingSlug } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

/**
 * The outbound hop. Logs OUTBOUND, then 302s to the account's OF tracking link.
 *
 * Funnel pass rate (outbound / landings) is the one stage we fully control, so
 * it gets its own event rather than being inferred from anything downstream.
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/f/[slug]/go'>) {
  const { slug } = await ctx.params
  const sessionHash = req.nextUrl.searchParams.get('s') ?? ''

  const link = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      ofTrackingLinkId: true,
      redditAccount: {
        select: { assignedCreator: { select: { ofUsername: true } } },
      },
    },
  })

  if (!link) {
    return NextResponse.redirect(await resolveMissingSlug(slug), 302)
  }

  const destination = ofDestination(
    link.ofTrackingLinkId,
    link.redditAccount.assignedCreator?.ofUsername ?? null,
  )

  // Logging must never stand between the visitor and the destination.
  try {
    if (sessionHash) {
      await recordOutbound({
        trackedLinkId: link.id,
        sessionHash,
        signals: readSignals(req.headers),
      })
    }
  } catch (err) {
    console.error('[funnel] outbound logging failed', err)
  }

  return NextResponse.redirect(destination, 302)
}
