// SVG → PNG(파비콘·아이콘), OG 이미지. 사용: node scripts/brand/raster.mjs
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const A = ROOT + 'web/assets/';
const svg = n => readFileSync(A + 'brand/' + n, 'utf8');
const b = await chromium.launch();
async function png(svgText, size, out, { bg = null } = {}) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const body = bg ? `background:${bg}` : 'background:transparent';
  await p.setContent(`<style>html,body{margin:0;${body}}svg{display:block;width:${size}px;height:${size}px}</style>${svgText}`);
  await p.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
await png(svg('favicon.svg'), 32, A + 'brand/favicon-32.png');
await png(svg('mark.svg'), 512, A + 'brand/icon-512.png');
await png(svg('mark.svg'), 512, ROOT + 'plugin/.claude-plugin/icon.png');
// iOS는 모서리를 스스로 둥글린다: 꽉 찬 사각으로.
await png(svg('mark.svg').replace(/rx="[\d.]+"/, 'rx="0"'), 180, A + 'brand/apple-touch-icon.png');

const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:Paperlogy;src:url(${A}fonts/Paperlogy-ExtraBold.woff2) format('woff2');font-weight:800}
@font-face{font-family:SUIT;src:url(${A}fonts/SUIT-Variable.woff2) format('woff2');font-weight:100 900}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
.og{display:grid;grid-template-columns:560px 1fr;height:630px;background:#f4f7fa;color:#101a2d}
.l{padding:72px 0 64px 72px;display:flex;flex-direction:column}
.l img{height:64px;width:auto;align-self:flex-start}
h1{font:800 54px/1.22 Paperlogy;letter-spacing:-0.02em;margin:auto 0 20px;word-break:keep-all}
p{font:500 22px/1.4 SUIT;color:#4b5669;margin:0}
.r{background:url(${A}img/cables-1376.webp) 62% 50%/cover}
</style><div class=og><div class=l><img src="${A}brand/wordmark.svg" alt="">
<h1>적어 둔 맥락이<br>다음 세션으로<br>이어집니다</h1><p>Claude Code와 OpenCode를 잇는 에이전트 메모</p></div><div class=r></div></div>`;
writeFileSync('/tmp/ctx-og.html', html);
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file:///tmp/ctx-og.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({ path: A + 'brand/og.png' });
await b.close();
console.log('ok');
