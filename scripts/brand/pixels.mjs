// 작은 크기 렌더를 픽셀 그대로 확대해 본다. 사용: node pixels.mjs <out.png>
import { chromium } from '/volume1/dev/vcat/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const B = new URL('../../web/assets/brand/', import.meta.url).pathname;
const s = n => 'data:image/svg+xml;base64,' + readFileSync(B + n).toString('base64');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 60 } });
await p.setContent(`<body style="margin:0;background:#f4f7fa"><div id=r style="display:flex;gap:8px;padding:4px;align-items:end;width:max-content">
<img src="${s('mark.svg')}" width=16><img src="${s('favicon.svg')}" width=16><img src="${s('mark.svg')}" width=32><img src="${s('favicon.svg')}" width=32>
<img src="${s('wordmark.svg')}" height=24><img src="${s('wordmark.svg')}" height=16></div>`);
await p.waitForTimeout(100);
const buf = await p.locator('#r').screenshot();
const q = await b.newPage({ viewport: { width: 1300, height: 400 } });
await q.setContent(`<body style="margin:0"><img src="data:image/png;base64,${buf.toString('base64')}" style="image-rendering:pixelated;zoom:4">`);
await q.waitForTimeout(100);
await q.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
