import { requireManager } from '@/lib/session'
import { TypefaceView } from './typeface-view'

export const metadata = { title: 'Typeface · Reddit Ops CRM' }

/**
 * A face is impossible to specify in words and trivial to recognise on sight.
 * This screen renders the CRM's own chrome — tiles, table, labels, buttons — in
 * each candidate so the choice is made by looking rather than by describing.
 */
export default async function TypefacePage() {
  await requireManager()
  return <TypefaceView />
}
