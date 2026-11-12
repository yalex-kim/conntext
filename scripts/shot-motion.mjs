// 소개 페이지의 스크롤 연동 움직임 확인: 움직임을 켠 채로 여러 스크롤 위치를 찍는다.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/volume1/dev/vcat/node_modules/')('playwright');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
await p.goto('http://localhost:7373/', { waitUntil: 'networkidle' });
const sup = await p.evaluate(() => CSS.supports('animation-timeline: view()'));
for (const y of [520, 700, 1500]) {
  await p.evaluate(v => window.scrollTo(0, v), y);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `.review/mine/motion-${y}.png` });
}
console.log('animation-timeline 지원:', sup, '| 오류:', errs.join(' | ') || '없음');
await b.close();
