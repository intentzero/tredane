// Tira os screenshots dos HTML temporários. Chamado por render_previews.py.
import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch();
for (const [dir, w, h, full] of [['mobile', 390, 844, false], ['desktop', 1440, 900, true]]) {
  fs.mkdirSync(`.tmp-png/${dir}`, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  for (const f of fs.readdirSync(`.tmp-html/${dir}`)) {
    const page = await ctx.newPage();
    await page.goto('file://' + process.cwd() + `/.tmp-html/${dir}/${f}`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `.tmp-png/${dir}/${f.replace('.html', '.png')}`, fullPage: full });
    await page.close();
  }
}
await browser.close();
