import { Card } from './card'
import { PageHeader } from '@/components/shell/page-header'

/**
 * Honest placeholder used while a phase is still being built. It states what
 * the screen will read from rather than rendering invented numbers — a stub
 * that shows fake data is worse than one that shows none.
 */
export function ComingSoon({
  title,
  phase,
  reads,
}: {
  title: string
  phase: string
  reads: string[]
}) {
  return (
    <>
      <PageHeader title={title} context={`Not built yet · arrives in ${phase}`} />
      <Card className="p-5">
        <p className="text-15 text-fg-secondary">This screen is scheduled for {phase}.</p>
        <p className="label-xs mt-4 mb-1.5">Will read from</p>
        <ul className="space-y-1">
          {reads.map((r) => (
            <li key={r} className="mono text-14 text-fg-muted">
              {r}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
