'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/shell/page-header'
import { cn } from '@/lib/utils'

/**
 * The stack written to `--font-sans`, not just the family name — the fallbacks
 * travel with the pick so a face that fails to load still degrades to something
 * chosen rather than to Times.
 */
const FACES = [
  {
    key: 'geist',
    name: 'Geist',
    note: 'Geometric grotesque. Flat terminals, tight fitting. Drawn for developer tools.',
    stack: 'var(--font-geist), system-ui, -apple-system, sans-serif',
  },
  {
    key: 'system',
    name: 'System (SF Pro)',
    note: 'The Mac’s own UI face. Native, invisible — and near-identical to Inter.',
    stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    key: 'inter',
    name: 'Inter',
    note: 'The current default before this screen existed. A Helvetica/SF-alike.',
    stack: 'var(--font-inter), system-ui, sans-serif',
  },
  {
    key: 'manrope',
    name: 'Manrope',
    note: 'Semi-geometric, open apertures, slightly rounded joints. Warmer.',
    stack: 'var(--font-manrope), system-ui, sans-serif',
  },
  {
    key: 'figtree',
    name: 'Figtree',
    note: 'Friendly geometric. Wide counters, tall x-height — reads big at 11px.',
    stack: 'var(--font-figtree), system-ui, sans-serif',
  },
  {
    key: 'outfit',
    name: 'Outfit',
    note: 'Strictly geometric, near-circular bowls. The most stylised of these.',
    stack: 'var(--font-outfit), system-ui, sans-serif',
  },
  {
    key: 'sora',
    name: 'Sora',
    note: 'Squarish grotesque with clipped corners. Technical, slightly severe.',
    stack: 'var(--font-sora), system-ui, sans-serif',
  },
] as const

const STORAGE_KEY = 'crm-typeface'

export function TypefaceView() {
  const [active, setActive] = useState<string | null>(null)

  // Read on mount rather than in useState's initialiser: this component renders
  // on the server first, where localStorage does not exist.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      setActive(FACES.find((f) => f.stack === saved)?.key ?? 'geist')
    } catch {
      setActive('geist')
    }
  }, [])

  function reset() {
    document.documentElement.style.removeProperty('--font-sans')
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* nothing pinned to clear */
    }
    setActive('geist')
  }

  function apply(stack: string, key: string) {
    document.documentElement.style.setProperty('--font-sans', stack)
    try {
      localStorage.setItem(STORAGE_KEY, stack)
    } catch {
      /* private mode — the face still applies for this tab */
    }
    setActive(key)
  }

  return (
    <div>
      <PageHeader
        title="Typeface"
        context="Click a card to apply it across the whole CRM. The choice is remembered in this browser; say which one and it gets hardcoded."
        actions={
          // A pinned choice in localStorage outranks the stylesheet, so a face
          // picked here silently survives every later change to the default.
          // This is the way back out.
          <button
            type="button"
            onClick={reset}
            className="border-hairline text-13 text-fg-secondary hover:border-fg-muted hover:text-fg cursor-pointer rounded-md border px-3 py-1.5"
          >
            Reset to default
          </button>
        }
      />

      <div className="grid gap-3 xl:grid-cols-2">
        {FACES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => apply(f.stack, f.key)}
            style={{ fontFamily: f.stack }}
            className={cn(
              'card cursor-pointer p-4 text-left transition-colors',
              active === f.key ? 'border-accent bg-accent-soft' : 'hover:border-fg-muted',
            )}
          >
            <div
              className="mb-3 flex items-baseline justify-between gap-3"
              style={{ fontFamily: 'var(--font-sans)' }}
            >
              <span className="text-16 text-fg font-semibold">{f.name}</span>
              <span className={cn('label-xs', active === f.key && 'text-accent')}>
                {active === f.key ? 'In use' : 'Apply'}
              </span>
            </div>
            <p className="sublabel mb-4" style={{ fontFamily: 'var(--font-sans)' }}>
              {f.note}
            </p>

            <Specimen />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Deliberately the shapes this product is actually made of: a stat tile, a
 * uppercase micro-label, tabular figures in a column, a username with an
 * underscore and digits. A pangram would show the face; this shows the CRM.
 */
function Specimen() {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
      <div>
        <div className="label-xs">Total clicks</div>
        <div className="text-36 text-fg tnum font-semibold">128,406</div>
        <div className="text-13 text-positive tnum mt-1">+12.4% vs prev</div>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="label-xs pb-1 text-left">Account</th>
            <th className="label-xs pb-1 text-right">Posts</th>
            <th className="label-xs pb-1 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="text-14 text-fg-secondary">
          {[
            ['u/example_one', '184', '$3,933.19'],
            ['u/example_two', '41', '$1,072.00'],
            ['u/example_three', '9', '$618.45'],
          ].map(([a, p, r]) => (
            <tr key={a} className="border-hairline border-t">
              <td className="mono py-1">{a}</td>
              <td className="tnum py-1 text-right">{p}</td>
              <td className="tnum text-fg py-1 text-right">{r}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
