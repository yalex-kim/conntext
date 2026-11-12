// 브랜드 SVG 생성기. 글자는 모노라인 중심선 경로 + 둥근 끝으로 그린다.
// 사용: node scripts/brand/build.mjs  → web/assets/brand/*.svg
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = new URL('../../web/assets/brand/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const INK = '#101a2d', MARKER = '#f7d22a', LIGHT = '#f4f7fa';
const W = 6.5;            // 획 굵기
const X = 36;             // x-height (중심선 기준, y=0 위, y=36 기준선)
const R = X / 2;
const f = n => +n.toFixed(2);
const pol = (cx, cy, r, deg) => [f(cx + r * Math.cos(deg * Math.PI / 180)), f(cy + r * Math.sin(deg * Math.PI / 180))];

// 각 글자: d(중심선 경로, 원점 왼쪽 위), w(중심선 폭), l/r(시각 간격 보정: 둥근 글자는 음수)
const AP = 44; // c, e의 열린 각
const G = {
  c: (() => { const [x1, y1] = pol(R, R, R, -AP), [x2, y2] = pol(R, R, R, AP);
    return { d: `M${x1} ${y1}A${R} ${R} 0 1 0 ${x2} ${y2}`, w: X, l: -2, r: -1 }; })(),
  o: { d: `M${R} 0A${R} ${R} 0 1 1 ${R} ${X}A${R} ${R} 0 1 1 ${R} 0Z`, w: X, l: -2, r: -2 },
  n: { d: `M0 ${X}V15A15 15 0 0 1 30 15V${X}`, w: 30, l: 0, r: 0 },
  t: { d: `M7 -13V25A11 11 0 0 0 18 ${X}H19M0 0H18`, w: 19, l: -1, r: -2 },
  e: (() => { const [x2, y2] = pol(R, R, R, AP - 2);
    return { d: `M0 ${R}H${X}A${R} ${R} 0 1 0 ${x2} ${y2}`, w: X, l: -2, r: -1 }; })(),
  x: { d: `M0 0L28 ${X}M28 0L0 ${X}`, w: 28, l: -1.5, r: -1.5 },
  p: { d: `M0 0V52M0 ${R}A${R} ${R} 0 1 1 ${X} ${R}A${R} ${R} 0 1 1 0 ${R}`, w: X, l: 0, r: -2 },
  a: { d: `M${X} 0V${X}M${X} ${R}A${R} ${R} 0 1 0 0 ${R}A${R} ${R} 0 1 0 ${X} ${R}`, w: X, l: -2, r: 0 },
  s: { d: `M24.5 5.5C22 1.8 18 0 13.5 0C7.5 0 3 3.2 3 9C3 15 8.5 16.6 13.5 18C19 19.5 25 21.2 25 27.5C25 33 20.5 36 14 36C8.8 36 4.4 34 2 30`, w: 25, l: -0.5, r: -0.5, x0: 2 },
};
const GAP = 9.5; // 기본 글자 사이(시각 가장자리 사이)

function setWord(word, x) {
  const parts = []; let prev = null;
  for (const ch of word) {
    const g = G[ch];
    if (prev) x += GAP + prev.r + g.l + W; // 앞 글자 오른쪽 시각 가장자리 → 이 글자 왼쪽 시각 가장자리
    const x0 = g.x0 || 0;
    parts.push(`<path transform="translate(${f(x - x0)} 0)" d="${g.d}"/>`);
    x += g.w - x0; prev = g;
  }
  return { svg: parts.join(''), end: x };
}

// 워드마크: 라벨(conn) + 바깥 글자. 좌표계: 글자 y 0..36, 라벨 y -14..50
function wordmark(inside, outside, outColor) {
  const PADL = 15, PADR = 14, LT = -15, LB = 51;
  const a = setWord(inside, PADL + W / 2);
  const labelR = a.end + W / 2 + PADR;
  const b = setWord(outside, labelR + 11 + W / 2 + (G[outside[0]].l));
  const right = b.end + W / 2 + 1;
  const vb = `-1 ${LT - 1} ${f(right + 1)} ${LB - LT + 2}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${inside}${outside}">` +
    `<rect x="0" y="${LT}" width="${f(labelR)}" height="${LB - LT}" rx="9" fill="${MARKER}"/>` +
    `<g fill="none" stroke="${INK}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round">${a.svg}</g>` +
    `<g fill="none" stroke="${outColor}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round">${b.svg}</g></svg>\n`;
}

// 심볼: 64 격자. 첫 n의 오른쪽 다리가 둘째 n의 왼쪽 기둥, 둘째 n은 한 단 아래.
function mark({ sw = 7, rx = 14, small = false } = {}) {
  const d = small
    ? 'M10.5 54V23A10.75 10.75 0 0 1 32 23V54M32 38A10.75 10.75 0 0 1 53.5 38V54'
    : 'M13 50V25.5A9.5 9.5 0 0 1 32 25.5V50M32 36.5A9.5 9.5 0 0 1 51 36.5V50';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Conntext">` +
    `<rect width="64" height="64" rx="${rx}" fill="${MARKER}"/>` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}

writeFileSync(OUT + 'mark.svg', mark());
writeFileSync(OUT + 'favicon.svg', mark({ sw: 8.5, rx: 11, small: true }));
writeFileSync(OUT + 'wordmark.svg', wordmark('conn', 'text', INK));
writeFileSync(OUT + 'wordmark-on-ink.svg', wordmark('conn', 'text', LIGHT));
writeFileSync(OUT + 'wordmark-connpass.svg', wordmark('conn', 'pass', INK));
console.log('ok');
