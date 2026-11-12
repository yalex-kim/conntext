// 인트로 프레임 렌더: node scripts/intro-frames.mjs <출력폴더> [fps] [미리보기 시각들(쉼표)]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire('/volume1/dev/vcat/node_modules/')('playwright');
const [,, out = '/tmp/intro', fpsArg = '60', only = ''] = process.argv;
const fps = +fpsArg; mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:7373/intro.html?capture', { waitUntil: 'networkidle' });
const dur = await p.evaluate(() => window.DURATION);
const times = only ? only.split(',').map(Number) : Array.from({ length: Math.round(dur * fps) + 1 }, (_, i) => i / fps);
for (const [i, t] of times.entries()) {
  await p.evaluate(t => window.render(t), t);
  await p.screenshot({ path: `${out}/${only ? 't' + t : String(i).padStart(4, '0')}.png` });
}
console.log('frames', times.length, 'errors', errs.join(' | ') || 'none');
await b.close();
