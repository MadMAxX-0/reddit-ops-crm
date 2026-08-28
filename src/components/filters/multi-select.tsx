'use client'

import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useFilterNav } from './use-filter-nav'

export interface Option {
  value: string
  label: string
  sub?: string
}

export function MultiSelectFilter({
  paramKey,
  label,
  options,
  selected,
  searchable = true,
}: {
  paramKey: string
  label: string
  options: Option[]
  selected: string[]
  searchable?: boolean
}) {
  const { set } = useFilterNav()
  const [q, setQ] = useState('')
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    set({ [paramKey]: next })
  }

  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? `1 ${label}`)
        : `${selected.length} ${label.toLowerCase()}`

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'border-hairline text-14 flex h-8 max-w-[220px] items-center gap-1.5 rounded-[6px] border px-2.5 transition-colors',
          selected.length
            ? 'bg-accent-soft border-accent/40 text-accent'
            : 'bg-surface-2 text-fg-secondary hover:text-fg',
        )}
      >
        <span className="truncate">{summary}</span>
        {selected.length > 0 ? (
          <X
            className="h-3 w-3 shrink-0 opacity-70 hover:opacity-100"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              set({ [paramKey]: null })
            }}
          />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-surface border-hairline z-50 w-64 rounded-[8px] border shadow-xl"
        >
          {searchable && (
            <div className="border-hairline border-b p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}…`}
                className="bg-surface-2 border-hairline text-14 text-fg placeholder:text-fg-muted h-7 w-full rounded-[5px] border px-2 outline-none"
              />
            </div>
          )}
          <div className="max-h-72 overflow-auto py-1">
            {shown.length === 0 && <p className="text-fg-muted text-13 px-3 py-2">No matches.</p>}
            {shown.map((o) => {
              const on = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="hover:bg-surface-2 flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                      on ? 'bg-accent border-accent' : 'border-hairline',
                    )}
                  >
                    {on && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-14 text-fg block truncate">{o.label}</span>
                    {o.sub && (
                      <span className="text-fg-muted block truncate text-[12px]">{o.sub}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-hairline border-t p-1.5">
              <button
                type="button"
                onClick={() => set({ [paramKey]: null })}
                className="text-13 text-fg-secondary hover:text-fg w-full px-1 text-left"
              >
                Clear {selected.length} selected
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Single-value variant used for status / tier style filters. */
export function SelectFilter({
  paramKey,
  label,
  options,
  value,
}: {
  paramKey: string
  label: string
  options: Option[]
  value?: string
}) {
  const { set } = useFilterNav()
  const active = options.find((o) => o.value === value)
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'border-hairline text-14 flex h-8 items-center gap-1.5 rounded-[6px] border px-2.5',
          active
            ? 'bg-accent-soft border-accent/40 text-accent'
            : 'bg-surface-2 text-fg-secondary hover:text-fg',
        )}
      >
        <span className="truncate">{active?.label ?? label}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-surface border-hairline z-50 w-52 rounded-[8px] border py-1 shadow-xl"
        >
          <button
            type="button"
            onClick={() => set({ [paramKey]: null })}
            className="hover:bg-surface-2 text-14 text-fg-secondary w-full px-2.5 py-1.5 text-left"
          >
            {label} — any
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set({ [paramKey]: o.value })}
              className={cn(
                'hover:bg-surface-2 text-14 w-full px-2.5 py-1.5 text-left',
                o.value === value ? 'text-accent' : 'text-fg',
              )}
            >
              {o.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
