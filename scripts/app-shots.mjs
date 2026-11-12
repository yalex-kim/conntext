// /app 스크린샷과 기본 점검(콘솔 오류, 가로 넘침).
// 실행: /volume1/dev/.tools/node/bin/node scripts/app-shots.mjs [이름 정규식]
// Playwright는 /volume1/dev/vcat/node_modules/playwright를 쓴다(PLAYWRIGHT 환경 변수로 바꿀 수 있다).
// 결과: .review/app/<화면>-desktop.png, <화면>-mobile.png. 저장 직후 상태를 찍을 때 만든 메모는 되돌린다.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/volume1/dev/vcat/node_modules/playwright');
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7373';
const OUT = new URL('../.review/app/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

async function token(email) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } });
  return (await r.json()).token;
}
const tokens = {};
const tok = async (who) => (tokens[who] ||= await token(`${who}@conn.example`));

// [이름, 계정(null이면 로그인 전), 해시, 준비 동작]
const SHOTS = [
  ['login', null, '#/home'],
  ['home', 'dohyun', '#/home'],
  ['home-team', 'dohyun', '#/home', { space: 6 }],
  ['home-team-admin', 'jimin', '#/home', { space: 6 }],
  ['home-notification', 'dohyun', '#/home', { notify: true }],
  ['wiki', 'dohyun', '#/wiki'],
  ['wiki-topic', 'dohyun', '#/wiki/1'],
  ['wiki-topic-memo', 'dohyun', '#/wiki/1?m=4'],
  ['wiki-unconfirmed', 'dohyun', '#/wiki/33'],
  ['wiki-instructions', 'dohyun', '#/wiki/instructions'],
  ['wiki-team', 'dohyun', '#/wiki/31', { space: 6 }],
  ['memos', 'dohyun', '#/memos'],
  ['memos-detail', 'dohyun', '#/memos/12'],
  ['memos-candidate', 'dohyun', '#/memos/48'],
  ['memos-empty', 'dohyun', '#/memos?q=zzqqxx'],
  ['agent', 'dohyun', '#/agent?project=github.com%2Fconnectivity%2Fble-gateway'],
  ['agent-ota', 'dohyun', '#/agent?project=github.com%2Fconnectivity%2Fota-service'],
  ['agent-global', 'dohyun', '#/agent?project='],
  ['agent-empty', 'taekyung', '#/agent?project='],
  ['sessions', 'dohyun', '#/sessions'],
  ['sessions-detail', 'dohyun', '#/sessions/3'],
  ['settings', 'dohyun', '#/settings'],
  ['settings-import', 'dohyun', '#/settings?tab=import'],
  ['settings-data', 'dohyun', '#/settings?tab=data'],
  ['admin', 'seoyun', '#/admin'],
  ['forbidden', 'dohyun', '#/admin'],
  ['capture-search', 'dohyun', '#/home', { act: 'search' }],
  ['capture-saved', 'dohyun', '#/home', { act: 'save' }],
  ['memos-kind', 'dohyun', '#/memos/18', { act: 'kind' }],
  ['dialog-promote', 'dohyun', '#/memos/18', { act: 'promote' }],
  ['dialog-confirm', 'dohyun', '#/sessions/3', { act: 'delete-dialog' }],
  ['rail-open', 'dohyun', '#/home', { act: 'rail', mobileOnly: true }],
];

const browser = await chromium.launch();
const problems = [];
for (const [name, who, hash, opt = {}] of SHOTS) {
  if (only && !only.test(name)) continue;
  for (const [vp, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    if (opt.mobileOnly && vp === 'desktop') continue;
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
    if (opt.notify) {
      await page.route('**/api/me', async (route) => {
        const res = await route.fetch();
        const j = await res.json();
        j.notifications = [{ id: 1, body: '운영자 한서윤님이 "장애 조사(INC-2211)" 사유로 내 메모 1건(m:7)을 열람했습니다. (예시)', created_at: Date.now() / 1000 - 3600 }];
        await route.fulfill({ response: res, json: j });
      });
    }
    const t = who ? await tok(who) : null;
    await page.addInitScript(([t, sp]) => {
      if (t) localStorage.setItem('conntext.token', t); else localStorage.removeItem('conntext.token');
      if (sp) localStorage.setItem('conntext.space', String(sp)); else localStorage.removeItem('conntext.space');
    }, [t, opt.space || null]);
    await page.goto(`${BASE}/app${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    let cleanup = null;
    if (opt.act === 'search' || opt.act === 'save') {
      await page.keyboard.press('Control+k');
      await page.keyboard.type(opt.act === 'search' ? '스테이징 배포' : '[테스트] 스크린샷용 메모입니다. 바로 되돌립니다');
      await page.waitForTimeout(700);
      if (opt.act === 'save') {
        await page.keyboard.press('Enter');
        await page.waitForSelector('.receipt', { timeout: 5000 });
        await page.waitForTimeout(300);
        cleanup = async () => {
          await page.click('#receipt-undo');
          await page.waitForSelector('.receipt--undone', { timeout: 5000 });
        };
      }
    } else if (opt.act === 'kind') {
      await page.click('[data-act="kind"]');
      await page.check('.kindopt input[value="instruction"]');
    } else if (opt.act === 'promote') {
      await page.click('[data-act="promote"]');
      await page.waitForSelector('.pm-list, .pm-blocked', { timeout: 5000 });
    } else if (opt.act === 'delete-dialog') {
      await page.click('#s-del');
      await page.waitForSelector('dialog[open]');
    } else if (opt.act === 'rail') {
      await page.click('#rail-open');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = `${OUT}${name}-${vp}.png`;
    await page.screenshot({ path: file, fullPage: !opt.act || opt.act === 'save' || opt.act === 'search' ? true : false });
    if (cleanup) await cleanup();
    if (overflow > 0) problems.push(`${name}/${vp}: 가로 넘침 ${overflow}px`);
    // admin.js가 없을 때의 HEAD 404는 의도된 확인이라 뺀다.
    const real = errs.filter((e) => !(name === 'admin' && /404/.test(e)));
    if (real.length) problems.push(`${name}/${vp}: ${real.join(' | ')}`);
    console.log(name, vp, overflow > 0 ? `overflow ${overflow}` : 'ok', real.length ? 'ERR' : '');
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? '\n문제:\n' + problems.join('\n') : '\n문제 없음');
