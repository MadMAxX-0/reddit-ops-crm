import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'

// Next 16 renamed this convention from middleware to proxy. It only reads the JWT — role checks live in authConfig.authorized,
// which is shared with the server components so the two can never disagree.
export default NextAuth(authConfig).auth

export const config = {
  // `api/diag` is public on purpose: it answers whether the host can reach
  // Reddit, which is the first thing anyone needs on a fresh deployment —
  // before there is a login to get past.
  matcher: ['/((?!api/auth|api/diag|f/|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
}
