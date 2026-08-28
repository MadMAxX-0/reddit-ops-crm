import { cn } from '@/lib/utils'

export type Tone = 'positive' | 'negative' | 'warning' | 'info' | 'accent' | 'muted'

const TONE_BG: Record<Tone, string> = {
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-fg-muted',
}

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  info: 'text-info',
  accent: 'text-accent',
  muted: 'text-fg-muted',
}

/**
 * Status is a coloured dot plus text, never a filled pill. Pills at 12px in a
 * 40px row turn a table into confetti; a 6px dot reads just as fast and lets
 * the label stay in the normal text colour.
 */
export function StatusDot({
  tone,
  label,
  className,
  colorText = false,
}: {
  tone: Tone
  label?: React.ReactNode
  className?: string
  colorText?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_BG[tone])} />
      {label != null && (
        <span className={cn('text-14', colorText ? TONE_TEXT[tone] : 'text-fg')}>{label}</span>
      )}
    </span>
  )
}
