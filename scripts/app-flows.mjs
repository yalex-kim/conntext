// /app 핵심 흐름 점검. 실제 브라우저로 누르고, 만든 테스트 데이터는 되돌리거나 지운다.
// 실행: /volume1/dev/.tools/node/bin/node scripts/app-flows.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/volume1/dev/vcat/node_modules/playwright');

const BASE = process.env.BASE || 'http://localhost:7373';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${r.url()}`));
const results = [];
const created = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}
const expect = (c, msg) => { if (!c) throw new Error(msg); };
const api = (path, opt = {}) => page.evaluate(async ([path, opt]) => {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('conntext.token') } });
  return r.json();
}, [path, opt]);
const hashId = () => Number((page.url().match(/#\/memos\/(\d+)/) || [])[1]);

await page.goto(`${BASE}/app`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/app#/home`);

await step('로그인', async () => {
  await page.click('[data-email="dohyun@conn.example"]');
  await page.waitForSelector('#h-resume');
});

await step('메모 저장과 되돌리기', async () => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('[테스트] 흐름 점검용 메모. 저장 직후 되돌립니다');
  await page.waitForTimeout(500);
  expect(await page.textContent('#cap-go') === '저장', '저장 동작이 기본이 아님');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.receipt');
  const t = await page.textContent('.receipt');
  expect(/저장됨/.test(t) && /m:\d+/.test(t), '결과 문구 없음: ' + t);
  await page.click('#receipt-undo');
  await page.waitForSelector('.receipt--undone');
});

await step('검색 후 결과로 이동', async () => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('게이트웨이 재시작');
  await page.waitForSelector('#cap-opt-1');
  await page.keyboard.press('ArrowDown');
  expect(await page.textContent('#cap-go') === '열기', '결과를 골랐는데 버튼이 열기가 아님');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/memos\/\d+/);
  await page.waitForSelector('.memo__body');
  await page.fill('#cap-input', '');
});

await step('후보 확인 후 되돌리기', async () => {
  await page.goto(`${BASE}/app#/home`);
  await page.waitForSelector('[data-confirm]');
  const id = await page.getAttribute('[data-confirm]', 'data-confirm');
  await page.click(`[data-confirm="${id}"]`);
  await page.waitForSelector('.toast__act');
  await page.waitForFunction((id) => !document.querySelector(`[data-confirm="${id}"]`), id);
  await page.click('.toast__act');
  await page.waitForSelector(`[data-confirm="${id}"]`);
});

await step('위키 근거 번호 → 미리보기 → 원문 열기', async () => {
  await page.goto(`${BASE}/app#/wiki/1`);
  await page.waitForSelector('.doc__body button[data-cite="12"]');
  await page.click('.doc__body button[data-cite="12"]');
  await page.waitForSelector('.cite-pop');
  expect((await page.textContent('.cite-pop')).includes('m:12'), '미리보기가 m:12가 아님');
  await page.click('.cite-pop button[data-memo="12"]');
  await page.waitForURL(/\?m=12/);
  await page.waitForSelector('#wiki-side .memo__body');
  expect((await page.textContent('#wiki-side .memo__title')).includes('m:12'), '옆 패널이 m:12가 아님');
});

let testId;
await step('메모 고치기(새 판이 이전 판 대체)', async () => {
  const r = await api('/api/memos', { method: 'POST', body: JSON.stringify({ text: '[테스트] 고치기 점검용 원본 메모입니다' }) });
  testId = r.memo_id;
  created.push(testId);
  await page.goto(`${BASE}/app#/memos/${testId}`);
  await page.click('[data-act="edit"]');
  await page.fill('#memo-edit', '[테스트] 고치기 점검용 메모의 고친 판입니다');
  await page.click('#memo-edit-form [type=submit]');
  await page.waitForSelector('.receipt');
  expect(/이전 메모 1건 대체/.test(await page.textContent('.receipt')), '대체 문구 없음');
  await page.waitForFunction((id) => !location.hash.includes(`/memos/${id}`), testId);
  // 새 판은 아래 되돌리기로 지워진다
  await page.waitForSelector('.chain__row');
  // 새 판을 지우면 원본이 다시 유효가 된다
  await page.click('#receipt-undo');
  await page.waitForSelector('.receipt--undone');
});

await step('종류 바꾸기와 되돌리기', async () => {
  await page.goto(`${BASE}/app#/memos/${testId}`);
  await page.waitForSelector('[data-act="kind"]');
  await page.click('[data-act="kind"]');
  await page.check('.kindopt input[value="instruction"]');
  await page.click('.kindform [type=submit]');
  await page.waitForSelector('.receipt');
  const t = await page.textContent('.receipt');
  expect(/종류를 바꿈/.test(t), '종류 변경 문구 없음: ' + t);
  await page.goto(`${BASE}/app#/home`);
  await page.waitForSelector('.log__row');
  const row = page.locator('.log__row', { hasText: '종류 변경' }).first();
  expect(/지식 → 지시·선호/.test(await row.textContent()), '홈 내역에 종류 변경 줄이 없음');
  await row.locator('[data-undo]').click();
  await page.waitForSelector('.log__row:has-text("되돌림")');
  const m = await api(`/api/memos/${testId}`);
  expect(m.kind === 'knowledge', '되돌린 뒤 종류가 ' + m.kind);
});

await step('절차: 언제 쓰는지 고치기와 되돌리기', async () => {
  const r = await api('/api/memos?kind=procedure');
  const proc = r.memos.find((m) => m.status === 'active');
  expect(proc, '절차 메모가 없음');
  await page.goto(`${BASE}/app#/memos/${proc.id}`);
  await page.waitForSelector('[data-act="when"]');
  const before = await page.textContent(`#when-slot-${proc.id} .when`);
  await page.click('[data-act="when"]');
  await page.fill(`#when-input-${proc.id}`, '[테스트] 게이트웨이를 다시 띄울 때');
  await page.click(`#when-form-${proc.id} [type=submit]`);
  await page.waitForSelector('.receipt');
  expect(/언제 쓰는지 바꿈/.test(await page.textContent('.receipt')), '변경 문구 없음');
  await page.waitForFunction((id) => document.querySelector(`#when-slot-${id} .when`)?.textContent.includes('[테스트]'), proc.id);
  await page.click('#receipt-undo');
  await page.waitForSelector('.receipt--undone');
  const m = await api(`/api/memos/${proc.id}`);
  expect(m.when_hint === before, '되돌린 뒤 값이 ' + m.when_hint);
});

await step('에이전트 화면 저장소 바꾸기', async () => {
  await page.goto(`${BASE}/app#/agent`);
  await page.waitForSelector('.ff__bar');
  await page.click('#ag-tabs [data-p$="ota-service"]');
  await page.waitForFunction(() => document.querySelector('.ff__title')?.textContent.includes('ota-service'));
  expect(await page.locator('.ff__field').count() > 1, '필드가 없음');
});

await step('팀으로 공유 미리보기', async () => {
  await page.goto(`${BASE}/app#/memos/18`);
  await page.click('[data-act="promote"]');
  await page.waitForSelector('dialog .pm-list, dialog .pm-blocked');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
});

await step('토큰 발급과 회수', async () => {
  await page.goto(`${BASE}/app#/settings`);
  await page.fill('#tk-label', '[테스트] 흐름 점검');
  await page.click('#issue-form [type=submit]');
  await page.waitForSelector('#tk-value');
  const tok = await page.inputValue('#tk-value');
  expect(tok.startsWith('ctx_'), '토큰 없음');
  expect((await page.textContent('.install')).includes(tok), '설치 명령에 토큰이 안 채워짐');
  await page.click('[data-label="[테스트] 흐름 점검"]');
  await page.click('dialog [data-dlg-act="1"]');
  await page.waitForFunction(() => !document.querySelector('[data-label="[테스트] 흐름 점검"]'));
});

await step('공간 전환', async () => {
  await page.click('.rail__space[data-space="6"]');
  await page.waitForFunction(() => document.querySelector('.page-title')?.textContent.includes('Connectivity'));
  expect(await page.locator('.rail__item').count() === 3, '팀 공간 메뉴가 셋이 아님');
  await page.click('.rail__space[data-space="2"]');
  await page.waitForSelector('#h-resume');
});

await step('키보드: Tab 포커스가 보인다', async () => {
  await page.goto(`${BASE}/app#/memos`);
  await page.waitForSelector('.mrow');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  const ok = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return el !== document.body && (cs.outlineStyle !== 'none' || cs.boxShadow !== 'none');
  });
  expect(ok, '포커스 표시 없음');
});

// 정리: 테스트로 만든 메모를 지운다
for (const id of created) await api(`/api/memos/${id}`, { method: 'DELETE', body: '{}' }).catch(() => {});
await browser.close();
console.log(results.join('\n'));
console.log(errors.length ? '\n콘솔 오류:\n' + errors.join('\n') : '\n콘솔 오류 없음');
