'use client'

import * as Popover from '@radix-ui/react-popover'
import { CalendarDays } from 'lucide-react'
import { RANGE_OPTIONS } from '@/lib/filters'
import { cn } from '@/lib/utils'
import { useFilterNav } from './use-filter-nav'

export function RangeFilter({ value, from, to }: { value: string; from?: string; to?: string }) {
  const { set } = useFilterNav()

  return (
    <div className="bg-surface-2 border-hairline flex items-center gap-0.5 rounded-[6px] border p-0.5">
      {RANGE_OPTIONS.filter((o) => o.value !== 'custom').map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => set({ range: o.value, from: null, to: null })}
          className={cn(
            'text-13 h-6 rounded-[4px] px-2 transition-colors',
            value === o.value
              ? 'bg-accent-soft text-accent font-medium'
              : 'text-fg-secondary hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
      <Popover.Root>
        <Popover.Trigger
          className={cn(
            'text-13 flex h-6 items-center gap-1 rounded-[4px] px-2',
            value === 'custom'
              ? 'bg-accent-soft text-accent font-medium'
              : 'text-fg-secondary hover:text-fg',
          )}
        >
          <CalendarDays className="h-3 w-3" />
          {value === 'custom' && from ? `${from} → ${to ?? from}` : 'Custom'}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="bg-surface border-hairline z-50 w-64 rounded-[8px] border p-3 shadow-xl"
          >
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                set({ range: 'custom', from: String(f.get('from')), to: String(f.get('to')) })
              }}
            >
              <label className="block">
                <span className="label-xs mb-1 block">From</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={from}
                  required
                  className="bg-surface-2 border-hairline text-14 text-fg h-7 w-full rounded-[5px] border px-2 outline-none"
                />
              </label>
              <label className="block">
                <span className="label-xs mb-1 block">To</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={to}
                  required
                  className="bg-surface-2 border-hairline text-14 text-fg h-7 w-full rounded-[5px] border px-2 outline-none"
                />
              </label>
              <button
                type="submit"
                className="bg-accent text-14 h-7 w-full rounded-[5px] font-medium text-white"
              >
                Apply
              </button>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

/** Me / Everyone. Managers only — a VA has nothing to toggle between. */
export function ScopeToggle({ value }: { value: 'me' | 'everyone' }) {
  const { set } = useFilterNav()
  return (
    <div className="bg-surface-2 border-hairline flex items-center gap-0.5 rounded-[6px] border p-0.5">
      {(['me', 'everyone'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => set({ scope: v === 'everyone' ? null : v })}
          className={cn(
            'text-13 h-6 rounded-[4px] px-2.5 capitalize transition-colors',
            value === v
              ? 'bg-accent-soft text-accent font-medium'
              : 'text-fg-secondary hover:text-fg',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
