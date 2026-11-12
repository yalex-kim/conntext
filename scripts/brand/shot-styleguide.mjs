// 스타일 가이드 스크린샷. 사용: node scripts/brand/shot-styleguide.mjs <outdir> [suffix]
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
const [,, out, suf = ''] = process.argv;
const b = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('requestfailed', r => errs.push('fail ' + r.url()));
  p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
  await p.goto('http://localhost:7373/styleguide.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await p.screenshot({ path: `${out}/styleguide-${name}${suf}.png`, fullPage: true });
  console.log(name, 'overflowX', over, errs.join('; ') || 'no errors');
}
await b.close();
