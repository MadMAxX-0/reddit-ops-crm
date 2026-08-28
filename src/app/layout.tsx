import type { Metadata } from 'next'
import { Geist, Inter, JetBrains_Mono, Manrope, Figtree, Outfit, Sora } from 'next/font/google'
import './globals.css'

// The interface face. Geist is a geometric grotesque drawn for developer tools:
// flat terminals, a single-storey `a` at weight, tight sidebearings. It reads as
// visibly different from Inter, which matters — Inter and the macOS system face
// are near-identical by design, so swapping between those two changes the
// stylesheet and nothing you can see.
const geist = Geist({ variable: '--font-geist', subsets: ['latin'], display: 'swap' })

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' })

// Still loaded and still wired to `--font-mono`, but nothing asks for it now:
// the interface reads as one sans, and tabular numerals keep the columns
// straight without monospacing the letters. Kept so the choice is one line to
// reverse rather than a hunt through a hundred class names.
const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

// Candidates for /admin/typeface only. `preload: false` keeps them off every
// other page's critical path — the browser fetches them the moment something
// actually asks for the family, and never otherwise.
const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
})
const sora = Sora({ variable: '--font-sora', subsets: ['latin'], display: 'swap', preload: false })

const FONT_VARS = [geist, inter, jetbrains, manrope, figtree, outfit, sora]
  .map((f) => f.variable)
  .join(' ')

// Applies a saved typeface before first paint, so picking one on
// /admin/typeface changes the whole CRM instead of just that page. Runs
// synchronously in <head> — after paint would flash the default face first.
const APPLY_TYPEFACE = `try{var f=localStorage.getItem('crm-typeface');if(f)document.documentElement.style.setProperty('--font-sans',f)}catch(e){}`

export const metadata: Metadata = {
  title: 'Reddit Ops CRM',
  description: 'Internal operations CRM for Reddit marketing',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${FONT_VARS} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_TYPEFACE }} />
      </head>
      <body className="bg-root text-fg min-h-full">{children}</body>
    </html>
  )
}
