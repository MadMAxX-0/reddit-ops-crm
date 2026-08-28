'use client'

import { SelectFilter } from '@/components/filters/multi-select'
import { useFilterNav } from '@/components/filters/use-filter-nav'
import { cn } from '@/lib/utils'

export function VaPicker({
  vas,
  value,
}: {
  vas: { id: string; name: string; role: string }[]
  value: string
}) {
  const { set } = useFilterNav()
  const current = vas.find((v) => v.id === value)

  return (
    <div className="flex items-center gap-2">
      {current && (
        <button
          type="button"
          onClick={() => set({ va: null })}
          className={cn('text-13 text-fg-muted hover:text-fg')}
        >
          back to mine
        </button>
      )}
      <SelectFilter
        paramKey="va"
        label="Viewing"
        value={value}
        options={vas.map((v) => ({ value: v.id, label: v.name, sub: v.role.toLowerCase() }))}
      />
    </div>
  )
}
