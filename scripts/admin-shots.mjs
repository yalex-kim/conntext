// 운영 화면(#/admin) 스크린샷과 기본 점검(콘솔 오류, 가로 넘침).
// 실행: /volume1/dev/.tools/node/bin/node scripts/admin-shots.mjs [이름 정규식]
// 결과: .review/app/admin-<이름>-desktop.png, -mobile.png. 데이터는 바꾸지 않는다(대화상자는 열기만 하고 닫는다).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/volume1/dev/vcat/node_modules/playwright');
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7373';
const OUT = new URL('../.review/app/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const tokens = {};
async function tok(who) {
  if (tokens[who]) return tokens[who];
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', body: JSON.stringify({ email: `${who}@conn.example` }), headers: { 'Content-Type': 'application/json' } });
  return (tokens[who] = (await r.json()).token);
}

const ALERTS = [
  { level: 'crit', key: 'hook_fail', title: '훅 수신 실패 급증', text: '24시간 훅 호출 212건 중 61건 실패. 클라이언트 업데이트로 연동이 깨졌을 수 있습니다.' },
  { level: 'warn', key: 'queue_lag', title: '처리 대기열 지연', text: '가장 오래된 작업이 340초째 대기 중입니다. 메모가 바로 반영되지 않습니다.' },
];

// [이름, 계정, 해시, 옵션]
const SHOTS = [
  ['overview', 'seoyun', '#/admin'],
  ['overview-alerts', 'seoyun', '#/admin', { alerts: true }],
  ['people', 'seoyun', '#/admin/people'],
  ['people-offboard', 'seoyun', '#/admin/people', { act: 'offboard' }],
  ['people-adduser', 'seoyun', '#/admin/people', { act: 'adduser' }],
  ['policies', 'seoyun', '#/admin/policies'],
  ['clients', 'seoyun', '#/admin/clients'],
  ['pipeline', 'seoyun', '#/admin/pipeline'],
  ['audit', 'seoyun', '#/admin/audit'],
  ['reports', 'seoyun', '#/admin/reports'],
  ['access', 'seoyun', '#/admin/access?memo=36'],
  ['access-breakglass', 'seoyun', '#/admin/access', { act: 'breakglass' }],
  ['auditor-overview', 'eunho', '#/admin'],
  ['auditor-policies', 'eunho', '#/admin/policies'],
  ['auditor-forbidden', 'eunho', '#/admin/people'],
];

const browser = await chromium.launch();
const problems = [];
for (const [name, who, hash, opt = {}] of SHOTS) {
  if (only && !only.test(name)) continue;
  for (const [vp, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
    if (opt.alerts) {
      await page.route('**/api/admin/overview', async (route) => {
        const res = await route.fetch();
        const j = await res.json();
        j.alerts = ALERTS;
        await route.fulfill({ response: res, json: j });
      });
    }
    const t = await tok(who);
    await page.addInitScript((t) => { localStorage.setItem('conntext.token', t); localStorage.removeItem('conntext.space'); }, t);
    await page.goto(`${BASE}/app${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.adm-body .sec, .adm-body .empty, .screen .empty', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    let full = true;
    if (opt.act === 'offboard') {
      // 처리하지 않는다. 대화상자를 열어 상태만 찍는다.
      await page.click('[data-off]:not([disabled])');
      await page.check('input[name="personal"][value="delete"]');
      full = false;
    } else if (opt.act === 'adduser') {
      await page.click('[data-act="add-user"]');
      full = false;
    } else if (opt.act === 'breakglass') {
      await page.click('#bg-open');
      await page.selectOption('#bg-user', { index: 1 });
      await page.fill('#bg-reason', '장애 조사');
      full = false;
    }
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}admin-${name}-${vp}.png`, fullPage: full });
    if (overflow > 0) problems.push(`${name}/${vp}: 가로 넘침 ${overflow}px`);
    const real = errs.filter((e) => !(name === 'auditor-forbidden' && /403/.test(e)));
    if (real.length) problems.push(`${name}/${vp}: ${real.join(' | ')}`);
    console.log(name, vp, overflow > 0 ? `overflow ${overflow}` : 'ok', real.length ? 'ERR ' + real.join(' | ') : '');
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? '\n문제:\n' + problems.join('\n') : '\n문제 없음');
