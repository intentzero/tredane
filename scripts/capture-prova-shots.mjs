import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const media = '/cursor/stores/bc-01a16ae7-fbb2-7a30-9ba5-224a15570315/media/issue-16'
mkdirSync(media, { recursive: true })

const shots = [
  ['http://localhost:5173/prova', 'Prova de componentes', 'prova-hub.png'],
  ['http://localhost:5173/prova/react-aria/m04', 'Calendário', 'prova-react-aria-m04.png'],
  ['http://localhost:5173/prova/react-aria/m05', 'Mover Beatriz', 'prova-react-aria-m05.png'],
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const sizes = {}
for (const [url, text, file] of shots) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(500)
  const dest = join(media, file)
  await page.screenshot({ path: dest, type: 'png' })
  sizes[file] = statSync(dest).size
}
await browser.close()
console.log(JSON.stringify(sizes, null, 2))
