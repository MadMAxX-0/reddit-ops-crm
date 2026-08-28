import { Suspense } from 'react'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Reddit Ops CRM' }

export default function LoginPage() {
  return (
    <main className="bg-root flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="bg-accent text-16 flex h-8 w-8 items-center justify-center rounded-[6px] font-bold text-white">
            R
          </span>
          <div className="leading-tight">
            <div className="text-16 text-fg font-semibold">Reddit Ops CRM</div>
            <div className="text-fg-muted text-13">Internal staff only</div>
          </div>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
