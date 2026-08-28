import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { landingFor, type Role } from '@/lib/rbac'

export default async function RootPage() {
  const session = await auth()
  if (!session?.user?.role) redirect('/login')
  redirect(landingFor(session.user.role as Role))
}
