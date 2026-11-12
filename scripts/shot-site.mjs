// 소개 페이지·매뉴얼 스크린샷: node scripts/shot-site.mjs <tag>
import { createRequire } from 'node:module';
const { chromium } = createRequire('/volume1/dev/vcat/node_modules/')('playwright');
const tag = process.argv[2] || 'v1';
const out = '/volume1/dev/conntext/.review/site';
const pages = [['landing', 'http://localhost:7373/'], ['manual', 'http://localhost:7373/manual']];
const b = await chromium.launch();
for (const [name, url] of pages) {
  for (const [vpn, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
    p.on('requestfailed', r => errs.push('reqfail ' + r.url()));
    p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
    if (name === 'landing') await p.screenshot({ path: `${out}/${name}-${vpn}-first-${tag}.png` });
    await p.screenshot({ path: `${out}/${name}-${vpn}-${tag}.png`, fullPage: true });
    console.log(name, vpn, JSON.stringify(ov), errs.join(' | ') || 'no errors');
    await p.close();
  }
}
await b.close();
