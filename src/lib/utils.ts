import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The type scale is numeric — `text-13`, `text-36` — and tailwind-merge cannot
 * tell those from a colour like `text-fg` unless it is told. Left to guess it
 * puts both in the `text-` group and keeps only the last one, so
 * `cn('text-36', 'text-fg')` silently dropped the size and the number rendered
 * at body size. It cost a set of summary tiles that looked ignored rather than
 * broken; anything using `cn` for both a size and a colour would have hit it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['13', '14', '15', '16', '18', '24', '36', '48'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
