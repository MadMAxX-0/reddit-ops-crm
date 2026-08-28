'use client'

import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { patchQuery } from '@/lib/filters'

/** Every filter control writes through here, so the URL stays the source of truth. */
export function useFilterNav() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const set = useCallback(
    (patch: Record<string, string | string[] | null | undefined>) => {
      const qs = patchQuery(params, patch)
      startTransition(() => router.replace(`${pathname}${qs}`, { scroll: false }))
    },
    [params, pathname, router],
  )

  return { set, params, pending }
}
