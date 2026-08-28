import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'bg-surface-2 border-hairline text-fg text-15 placeholder:text-fg-muted h-8 w-full rounded-[6px] border px-2.5 outline-none focus:border-[#4a4a4a]',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'bg-surface-2 border-hairline text-fg text-15 placeholder:text-fg-muted w-full rounded-[6px] border px-2.5 py-2 outline-none focus:border-[#4a4a4a]',
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="label-xs mb-1 block">
        {label}
        {required && <span className="text-accent ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-fg-muted text-13 mt-1 block">{hint}</span>}
    </label>
  )
}
