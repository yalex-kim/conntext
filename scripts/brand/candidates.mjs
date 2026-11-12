// 심볼 후보 A·B·C 생성 + 16/32px PNG(확대 비교용). 사용: node scripts/brand/candidates.mjs
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
const D = new URL('../../web/assets/brand/', import.meta.url).pathname;
const INK = '#101a2d', MARKER = '#f7d22a', SURFACE = '#fcfdff', LINE = '#c9cfd9';
const f = n => +n.toFixed(2);
const head = (label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label}">`;

// A. 라벨 태그: 잉크 사각 위에 V자 노치가 있는 노란 태그, 그 위에 떨어진 n 두 개
function markA() {
  const n = x => `M${x} 40.5V30A5.5 5.5 0 0 1 ${x + 11} 30V40.5`;
  return head('Conntext 후보 A') +
    `<rect width="64" height="64" rx="14" fill="${INK}"/>` +
    `<path d="M10.5 14H58L49 32L58 50H10.5A4.5 4.5 0 0 1 6 45.5V18.5A4.5 4.5 0 0 1 10.5 14Z" fill="${MARKER}"/>` +
    `<path d="${n(12.5)}${n(30.5)}" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}
// B. 넘겨주기: 잉크 사각 위에 밝은 생명선 둘, 그 사이를 내려가며 건너는 노란 화살표(메모가 건너간다)
function markB() {
  const [x0, y0, x1, y1] = [17, 26, 45, 38];
  const a = Math.atan2(y1 - y0, x1 - x0), L = 10, sp = 0.62;
  const h1 = [x1 - L * Math.cos(a - sp), y1 - L * Math.sin(a - sp)], h2 = [x1 - L * Math.cos(a + sp), y1 - L * Math.sin(a + sp)];
  return head('Conntext 후보 B') +
    `<rect width="64" height="64" rx="14" fill="${INK}"/>` +
    `<path d="M14 12V52M50 12V52" fill="none" stroke="#c3cad6" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M${x0} ${y0}L${x1} ${y1}M${f(h1[0])} ${f(h1[1])}L${x1} ${y1}L${f(h2[0])} ${f(h2[1])}" fill="none" stroke="${MARKER}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}
// C. 케이블에 감긴 라벨: 밝은 사각을 가로지르는 잉크 케이블, 그 위에 감긴 노란 띠
function markC() {
  const ang = -30;
  return head('Conntext 후보 C') +
    `<defs><clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath></defs>` +
    `<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" fill="${SURFACE}" stroke="${LINE}" stroke-width="1.5"/>` +
    `<g clip-path="url(#c)" transform="rotate(${ang} 32 32)">` +
    `<rect x="-12" y="25" width="88" height="14" fill="${INK}"/>` +
    `<rect x="24" y="17" width="16" height="30" rx="3" fill="${MARKER}"/>` +
    `<path d="M29.5 18V46" stroke="#e2b000" stroke-width="1.5"/></g></svg>\n`;
}
const out = { 'mark-a.svg': markA(), 'mark-b.svg': markB(), 'mark-c.svg': markC() };
for (const [k, v] of Object.entries(out)) writeFileSync(D + 'candidates/' + k, v);

// 확대 비교용 래스터: 브라우저가 실제로 16·32px에 그리는 픽셀
const b = await chromium.launch();
const src = { current: readFileSync(D + 'favicon.svg', 'utf8'), a: out['mark-a.svg'], b: out['mark-b.svg'], c: out['mark-c.svg'] };
for (const [k, svg] of Object.entries(src)) for (const s of [16, 32]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
  await p.screenshot({ path: `${D}candidates/${k}-${s}.png`, omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
  await p.close();
}
await b.close();
console.log('ok');
