/**
 * Dev-only visual check: logs in as a seeded user and screenshots pages.
 *   npx tsx scripts/shoot.ts <email> <path> [path...]
 * Uses the system Chrome rather than downloading a browser.
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.SHOOT_BASE ?? 'http://localhost:3000'
const OUT = process.env.SHOOT_OUT ?? '/tmp/shots'

async function main() {
  const [email, ...paths] = process.argv.slice(2)
  if (!email || !paths.length) throw new Error('usage: shoot.ts <email> <path...>')
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--force-color-profile=srgb'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.type('input[name=email]', email)
  await page.type('input[name=password]', 'password123')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type=submit]'),
  ])

  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 900))
    const file = path.join(OUT, `${p.replace(/\W+/g, '_') || 'root'}.png`)
    await page.screenshot({ path: file as `${string}.png`, fullPage: false })
    console.log(file)
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
