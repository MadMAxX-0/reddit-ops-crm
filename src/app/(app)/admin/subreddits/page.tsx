import { notFound } from 'next/navigation'

/**
 * Subreddit Lists is parked while it is restructured.
 *
 * A 404 rather than a redirect: the address is genuinely not a screen right
 * now, and bouncing it somewhere that renders would say the opposite. The
 * previous implementation is kept beside this file as `_parked.page.tsx.bak`
 * — the dot keeps it out of routing.
 */
export default function Parked() {
  notFound()
}
