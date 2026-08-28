import type { Role } from '@/lib/rbac'
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: Role
      timezone: string
    } & DefaultSession['user']
  }

  interface User {
    role: Role
    timezone: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string
    role?: Role
    timezone?: string
  }
}
