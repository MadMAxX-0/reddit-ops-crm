'use client'

import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFilterNav } from './use-filter-nav'

export function SearchFilter({
  value,
  placeholder = 'Search…',
}: {
  value: string
  placeholder?: string
}) {
  const { set } = useFilterNav()
  const [text, setText] = useState(value)

  // Resync when the URL changes underneath us — a back/forward, or another
  // control clearing the query. Adjusting during render keeps the input from
  // flashing the stale term for a frame.
  const [renderedValue, setRenderedValue] = useState(value)
  if (value !== renderedValue) {
    setRenderedValue(value)
    setText(value)
  }

  // debounce so typing does not fire a server round-trip per keystroke
  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => set({ q: text || null }), 300)
    return () => clearTimeout(t)
  }, [text, value, set])

  return (
    <div className="relative">
      <Search className="text-fg-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="bg-surface-2 border-hairline text-14 text-fg placeholder:text-fg-muted h-8 w-56 rounded-[6px] border pr-7 pl-8 outline-none focus:border-[#4a4a4a]"
      />
      {text && (
        <button
          type="button"
          onClick={() => setText('')}
          className="text-fg-muted hover:text-fg absolute top-1/2 right-2 -translate-y-1/2"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
