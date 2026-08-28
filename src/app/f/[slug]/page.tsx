import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getWorkspace } from '@/lib/workspace'
import { ofDestination, readSignals, recordLanding, resolveMissingSlug } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Continue',
  robots: { index: false, follow: false },
}

/**
 * The funnel page. Public, unauthenticated, and excluded from the auth proxy.
 *
 * It logs LANDED on load and forwards to this account's OF tracking link when
 * the visitor taps through. Nothing here can throw a user-visible error: a
 * broken bio link on a live account is money quietly draining away, so an
 * unknown slug is logged, alerted on, and still sent somewhere that works.
 */
export default async function FunnelPage(props: PageProps<'/f/[slug]'>) {
  const { slug } = await props.params
  const h = await headers()
  const signals = readSignals(h)

  const link = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      ofTrackingLinkId: true,
      redditAccount: {
        select: {
          id: true,
          username: true,
          assignedCreator: {
            select: { stageName: true, ofUsername: true, avatarUrl: true, niche: true },
          },
        },
      },
    },
  })

  if (!link) {
    const fallback = await resolveMissingSlug(slug)
    redirect(fallback)
  }

  const workspace = await getWorkspace()
  const { sessionHash } = await recordLanding({
    trackedLinkId: link.id,
    redditAccountId: link.redditAccount.id,
    signals,
    attributionWindowH: workspace.attributionWindowH,
  })

  const creator = link.redditAccount.assignedCreator
  const destination = ofDestination(link.ofTrackingLinkId, creator?.ofUsername ?? null)

  return (
    <main className="bg-root flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-[360px] text-center">
        <div className="bg-accent-soft text-accent mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-[26px] font-semibold">
          {(creator?.stageName ?? 'x').slice(0, 1).toUpperCase()}
        </div>
        <h1 className="text-24 text-fg font-semibold">{creator?.stageName ?? 'Come say hi'}</h1>
        {creator?.niche && <p className="text-fg-secondary text-15 mt-1">{creator.niche}</p>}
        <p className="text-fg-muted text-15 mt-5 leading-relaxed">
          Everything is on the other side. Free to join, no card needed.
        </p>

        <form action={`/f/${slug}/go`} method="GET" className="mt-6">
          <input type="hidden" name="s" value={sessionHash} />
          <button
            type="submit"
            className="bg-accent text-16 h-11 w-full rounded-[8px] font-semibold text-white transition-colors hover:bg-[#e2591b]"
          >
            Open my page
          </button>
        </form>

        <noscript>
          <a href={destination} className="text-accent text-14 mt-3 inline-block underline">
            Continue
          </a>
        </noscript>

        <p className="text-fg-muted mt-6 text-[12px]">18+ only</p>
      </div>
    </main>
  )
}
