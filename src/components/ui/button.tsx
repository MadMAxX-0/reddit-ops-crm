'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-[4px] whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 font-medium uppercase tracking-[0.07em]',
  {
    variants: {
      variant: {
        // Outlined and white, not filled and orange. Colour is reserved for
        // things that carry meaning; a button is not one of them.
        primary: 'bg-fg text-root hover:bg-[#e6e6e6] font-semibold',
        secondary:
          'bg-transparent text-fg border border-hairline hover:border-[#4a4a4a] hover:bg-surface-2',
        ghost: 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
        danger: 'bg-transparent text-negative border border-negative/40 hover:bg-negative/10',
        link: 'text-fg hover:underline underline-offset-4 normal-case tracking-normal font-sans',
      },
      size: {
        sm: 'h-7 px-2.5 text-14',
        md: 'h-8 px-3 text-15',
        lg: 'h-9 px-4 text-15',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof button> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(button({ variant, size }), className)} {...props} />
}

export { button as buttonVariants }
