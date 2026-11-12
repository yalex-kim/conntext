// 브랜드 미리보기: 여러 크기로 렌더해 PNG로 찍는다. 사용: node preview.mjs <outpng>
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = new URL('../../web/assets/brand/', import.meta.url).pathname;
const s = n => 'data:image/svg+xml;base64,' + Buffer.from(readFileSync(B + n)).toString('base64');
const img = (n, style) => `<img src="${s(n)}" style="${style}">`;
const html = `<body style="margin:0;padding:24px;background:#f4f7fa;font:12px sans-serif">
<div style="display:flex;gap:24px;align-items:end">${[16, 32, 64, 200].map(x => img('mark.svg', `width:${x}px`)).join('')}
${[16, 32].map(x => img('favicon.svg', `width:${x}px`)).join('')}</div>
<div style="display:flex;gap:24px;align-items:end;margin-top:24px">${img('wordmark.svg', 'height:24px')}${img('wordmark.svg', 'height:40px')}${img('wordmark-connpass.svg', 'height:24px')}</div>
<div style="margin-top:24px">${img('wordmark.svg', 'height:80px')}</div>
<div style="margin-top:24px">${img('wordmark-connpass.svg', 'height:80px')}</div>
<div style="margin-top:24px;background:#101a2d;padding:16px;display:flex;gap:24px;align-items:end">${img('wordmark-on-ink.svg', 'height:24px')}${img('wordmark-on-ink.svg', 'height:80px')}</div>
<div style="margin-top:24px">${img('wordmark.svg', 'height:240px')}</div>
</body>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: +(process.argv[3] || 1) });
await p.setContent(html); await p.waitForTimeout(200);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
