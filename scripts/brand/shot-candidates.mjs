// 후보 비교 페이지 스크린샷. 사용: node scripts/brand/shot-candidates.mjs <outdir>
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
const out = process.argv[2];
const b = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp, reducedMotion: 'reduce' });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
  await p.goto('http://localhost:7373/brand-candidates.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await p.screenshot({ path: `${out}/candidates-${name}.png`, fullPage: true });
  console.log(name, 'overflowX', over, errs.join('; ') || 'no errors');
}
await b.close();
