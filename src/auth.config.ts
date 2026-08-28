import type { NextAuthConfig } from 'next-auth'
import { canAccess, landingFor, type Role } from '@/lib/rbac'

/**
 * Edge-safe half of the auth config. No prisma, no bcrypt — the middleware
 * imports this and only ever reads the JWT.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/login', error: '/login' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: Role }).role
        token.timezone = (user as { timezone?: string }).timezone
        token.uid = user.id
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? ''
        session.user.role = token.role as Role
        session.user.timezone = (token.timezone as string) ?? 'UTC'
      }
      return session
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      const role = auth?.user?.role as Role | undefined

      if (pathname === '/login') {
        if (role) return Response.redirect(new URL(landingFor(role), request.nextUrl))
        return true
      }
      if (!role) return false
      if (pathname === '/') return Response.redirect(new URL(landingFor(role), request.nextUrl))
      // API routes authenticate here but authorise inside the handler, where the
      // check can see the actual resource rather than guessing from the path
      if (pathname.startsWith('/api/')) return true
      if (!canAccess(role, pathname)) {
        return Response.redirect(new URL(`${landingFor(role)}?denied=1`, request.nextUrl))
      }
      return true
    },
  },
} satisfies NextAuthConfig
