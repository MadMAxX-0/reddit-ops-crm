import { cn } from '@/lib/utils'

const TIER: Record<string, string> = {
  S: 'text-accent border-accent/40 bg-accent-soft',
  A: 'text-info border-info/40 bg-info-soft',
  B: 'text-fg-secondary border-hairline bg-surface-2',
  C: 'text-fg-muted border-hairline bg-surface-2',
}

export function TierBadge({ tier, className }: { tier: string; className?: string }) {
  return (
    <span
      className={cn(
        'mono text-13 inline-flex h-4.5 min-w-5 items-center justify-center rounded-[4px] border px-1 font-medium',
        TIER[tier] ?? TIER.C,
        className,
      )}
    >
      {tier}
    </span>
  )
}

export function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'text-13 border-hairline bg-surface-2 text-fg-secondary inline-flex h-4.5 items-center rounded-[4px] border px-1.5',
        className,
      )}
      {...props}
    />
  )
}
