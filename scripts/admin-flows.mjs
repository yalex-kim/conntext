// 운영 화면 핵심 흐름 점검. 실제 브라우저로 누르고, 바꾼 값은 원래대로 돌린다.
// 실행: /volume1/dev/.tools/node/bin/node scripts/admin-flows.mjs
// 남는 것: 확인용 사용자 1명(퇴사 처리돼 비활성), 정도현에게 간 예외 열람 통지 1건, 감사 로그 기록.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/volume1/dev/vcat/node_modules/playwright');

const BASE = process.env.BASE || 'http://localhost:7373';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
const page = await ctx.newPage();
const errors = [];
const expected400 = [];
page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  if (r.status() === 400) expected400.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
  else if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});
const results = [];
async function step(name, fn) {
  if (process.env.AUDITOR_ONLY && !/^(감사자|운영자 로그인)/.test(name)) return;
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
const toastText = async () => (await page.locator('.toast__text').allTextContents()).join(' | ');
const closeToasts = async () => { for (const b of await page.locator('.toast__close').all()) await b.click().catch(() => {}); };

await page.goto(`${BASE}/app`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/app#/admin`);

let original;
await step('운영자 로그인과 현황판', async () => {
  await page.click('[data-email="seoyun@conn.example"]');
  await page.waitForSelector('#h-sys');
  expect(await page.locator('.lat__row').count() >= 3, '응답 시간 줄이 없음');
  expect(await page.locator('.vb').count() >= 3, '일별 막대가 없음');
  expect(await page.locator('.q__row').count() >= 6, '품질 줄이 없음');
  original = await api('/api/admin/policies');
});

for (const [tab, sel] of [['people', '#h-users'], ['policies', '#h-mask'], ['clients', '#h-cl'], ['pipeline', '#h-pv'], ['audit', '#h-au'], ['reports', '#h-rep'], ['access', '#h-tr'], ['overview', '#h-sys']]) {
  await step(`탭 열기: ${tab}`, async () => {
    await page.click(`.adm-tabs [data-tab="${tab}"]`);
    await page.waitForSelector(sel, { timeout: 6000 });
    expect((await page.locator('.adm-tabs [aria-current="page"]').getAttribute('data-tab')) === tab, '현재 탭 표시가 틀림');
  });
}

await step('키보드: 탭 링크에 보이는 포커스', async () => {
  await page.focus('.adm-tabs [data-tab="overview"]');
  await page.keyboard.press('Tab');
  const st = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { tag: document.activeElement.dataset.tab, o: s.outlineStyle, w: s.outlineWidth }; });
  expect(st.tag === 'people' && st.o !== 'none' && st.w !== '0px', `포커스 링이 안 보임 ${JSON.stringify(st)}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#h-users');
});

await step('마스킹 규칙 추가·시험·저장·틀린 정규식 거부·원복', async () => {
  await page.goto(`${BASE}/app#/admin/policies`);
  await page.waitForSelector('#mrules .mrule');
  const n0 = await page.locator('#mrules .mrule').count();
  await page.click('[data-act="rule-add"]');
  await page.keyboard.type('[테스트] 사내 키');
  await page.fill(`#mr-p-${n0}`, 'connkey_[A-Za-z0-9]{8}');
  expect(!(await page.locator('#m-dirty').isHidden()), '변경 표시가 없음');
  await page.fill('#mt-in', '배포 키는 connkey_AbCd1234 입니다');
  await page.click('#mtest [type="submit"]');
  await page.waitForSelector('.mtest__out mark');
  expect((await page.textContent('.mtest__out')).includes('[마스킹: [테스트] 사내 키]'), '시험에서 가려지지 않음');
  await page.click('[data-act="rule-save"]');
  await page.waitForFunction(() => document.querySelector('#m-dirty').hidden);
  let p = await api('/api/admin/policies');
  expect(p.masking_rules.length === n0 + 1, '저장되지 않음');
  // 틀린 정규식
  await page.fill(`#mr-p-${n0}`, 'connkey_(abc');
  await page.click('[data-act="rule-save"]');
  await page.waitForSelector('#m-err .alert--danger');
  expect((await page.textContent('#m-err')).includes('정규식 오류'), '서버 오류 문구가 보이지 않음');
  expect((await page.getAttribute(`#mr-p-${n0}`, 'aria-invalid')) === 'true', '틀린 칸 표시가 없음');
  // 원복: 추가한 규칙 지우고 저장
  await page.click(`[data-del="${n0}"]`);
  await page.click('[data-act="rule-save"]');
  await page.waitForFunction(() => document.querySelector('#m-dirty').hidden);
  p = await api('/api/admin/policies');
  expect(JSON.stringify(p.masking_rules) === JSON.stringify(original.masking_rules), '마스킹 규칙이 원래대로 돌아가지 않음');
  await closeToasts();
});

await step('보존 기간 변경과 원복', async () => {
  const f = '#pf-retention-transcript_days';
  await page.fill(f, '31');
  await page.click('form[data-pol="retention"] [type="submit"]');
  await page.waitForFunction(() => document.querySelector('form[data-pol="retention"] .pol-dirty').hidden);
  let p = await api('/api/admin/policies');
  expect(p.retention.transcript_days === 31, '31로 저장되지 않음');
  // 잘못된 값은 화면에서 거부
  await page.fill(f, '0');
  await page.click('form[data-pol="retention"] [type="submit"]');
  await page.waitForSelector('form[data-pol="retention"] .field__error');
  await page.fill(f, String(original.retention.transcript_days));
  await page.click('form[data-pol="retention"] [type="submit"]');
  await page.waitForFunction(() => document.querySelector('form[data-pol="retention"] .pol-dirty').hidden);
  p = await api('/api/admin/policies');
  expect(JSON.stringify(p.retention) === JSON.stringify(original.retention), '보존 기간이 원래대로 돌아가지 않음');
  await closeToasts();
});

const email = `offboard-check-${Date.now().toString(36)}@conn.example`;
await step('사용자 추가', async () => {
  await page.goto(`${BASE}/app#/admin/people`);
  await page.waitForSelector('#h-users');
  await page.click('[data-act="add-user"]');
  await page.click('dialog [data-dlg-act="1"]');
  await page.waitForSelector('dialog #nu-err .field__error');
  await page.fill('#nu-email', email);
  await page.fill('#nu-name', '[테스트] 퇴사 확인');
  await page.click('dialog [data-dlg-act="1"]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForSelector(`text=${email}`);
});

await step('추가한 사용자의 퇴사 처리', async () => {
  const users = (await api('/api/admin/users')).users;
  const u = users.find((x) => x.email === email);
  expect(u && !['dohyun', 'jimin', 'taekyung', 'seoyun', 'eunho'].some((k) => u.email.startsWith(k)), '확인용 사용자가 아님');
  await page.click(`[data-off="${u.id}"]`);
  const go = page.locator('dialog [data-dlg-act="1"]');
  expect(await go.isDisabled(), '선택 전인데 실행 버튼이 켜짐');
  await page.check('dialog input[name="personal"][value="delete"]');
  expect((await page.textContent('#off-ledger')).includes('개인 메모 0건'), '지워지는 것 목록이 갱신되지 않음');
  expect(await go.isDisabled(), '이메일 확인 전인데 실행 버튼이 켜짐');
  await page.fill('#off-type', email);
  expect(!(await go.isDisabled()), '이메일을 넣어도 버튼이 꺼져 있음');
  await go.click();
  await page.waitForSelector('dialog', { state: 'detached' });
  const after = (await api('/api/admin/users')).users.find((x) => x.email === email);
  expect(after.deactivated_at, '비활성이 되지 않음');
  await closeToasts();
});

await step('팀 구성원 역할 변경과 원복', async () => {
  const sel = '#tr-6-2';
  await page.waitForSelector(sel);
  const was = await page.inputValue(sel);
  const to = was === 'member' ? 'admin' : 'member';
  await page.selectOption(sel, to);
  await page.waitForFunction(([s, to]) => document.querySelector(s)?.value === to && !document.querySelector(s).disabled, [sel, to]);
  let t = (await api('/api/admin/teams')).teams.find((x) => x.id === 6);
  expect(t.members.find((m) => m.id === 2).role === to, '역할이 바뀌지 않음');
  await page.selectOption(sel, was);
  await page.waitForFunction(([s, w]) => document.querySelector(s)?.value === w && !document.querySelector(s).disabled, [sel, was]);
  t = (await api('/api/admin/teams')).teams.find((x) => x.id === 6);
  expect(t.members.find((m) => m.id === 2).role === was, '역할이 원래대로 돌아가지 않음');
  await closeToasts();
});

await step('추적 열기', async () => {
  await page.goto(`${BASE}/app#/admin/access`);
  await page.waitForSelector('#tr-id');
  await page.fill('#tr-id', 'm:36');
  await page.press('#tr-id', 'Enter');
  await page.waitForSelector('.tr__life .tr__step');
  expect((await page.textContent('.tr__nobody')).includes('보이지 않습니다'), '본문 숨김 안내가 없음');
  expect(!(await page.textContent('#tr-out')).includes('mqtt-broker 먼저'), '추적에 본문이 보임');
});

await step('예외 열람: 짧은 사유 거부, 그다음 열람', async () => {
  await page.click('#bg-open');
  await page.selectOption('#bg-user', '2');
  await page.fill('#bg-memo', '12');
  await page.fill('#bg-reason', '확인 필요');
  const go = page.locator('dialog [data-dlg-act="1"]');
  expect(await go.isDisabled(), '확인 체크 전인데 버튼이 켜짐');
  await page.check('#bg-ack');
  await go.click();
  await page.waitForSelector('#bg-err .field__error');
  expect((await page.textContent('#bg-err')).includes('10자'), '짧은 사유 안내가 없음');
  expect(await page.locator('dialog[open]').count() === 1, '대화상자가 닫힘');
  await page.fill('#bg-reason', '[테스트] 운영 화면 점검: 예외 열람 흐름과 통지 확인');
  await go.click();
  await page.waitForSelector('.bg-open');
  expect((await page.textContent('.bg-open__meta')).includes('통지했습니다'), '통지 안내가 없음');
  await page.click('[data-act="bg-close"]');
  await page.waitForSelector('.bg-open', { state: 'detached' });
  await closeToasts();
});

await step('감사 로그에서 방금 한 일 확인', async () => {
  await page.goto(`${BASE}/app#/admin/audit`);
  await page.waitForSelector('#au-act');
  for (const a of ['break_glass', 'user_offboard', 'user_create', 'team_member', 'policy_update']) {
    await page.selectOption('#au-act', a);
    await page.waitForFunction((a) => document.querySelector('#au-act')?.value === a && document.querySelector('#au-list table, #au-list .empty'), a);
    const rows = await page.locator('#au-list tbody tr').count();
    expect(rows > 0, `${a} 기록이 없음`);
    if (a === 'break_glass') {
      expect(await page.locator('#au-list tr.is-hot').count() > 0, '예외 열람 줄이 강조되지 않음');
      expect((await page.textContent('#au-list')).includes('[테스트] 운영 화면 점검'), '사유가 보이지 않음');
    }
  }
});

const pol = await api('/api/admin/policies');
await step('정책이 처음 값과 같음', async () => {
  expect(JSON.stringify(pol) === JSON.stringify(original), '정책 값이 처음과 다름');
});
await step('감사자: 탭 셋과 권한 없음', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/app#/admin`);
  await page.reload();
  await page.click('[data-email="eunho@conn.example"]');
  await page.waitForSelector('#h-sys');
  const tabs = await page.locator('.adm-tabs [data-tab]').evaluateAll((a) => a.map((x) => x.dataset.tab));
  expect(JSON.stringify(tabs) === JSON.stringify(['overview', 'policies', 'audit']), `탭이 다름 ${tabs}`);
  await page.goto(`${BASE}/app#/admin/people`);
  await page.waitForSelector('.empty__title');
  expect((await page.textContent('.empty__title')).includes('권한이 없습니다'), '권한 없음이 보이지 않음');
  await page.goto(`${BASE}/app#/admin/policies`);
  await page.waitForSelector('#mrules .mrule');
  expect(await page.locator('#mr-p-0').getAttribute('readonly') !== null, '정책 입력이 읽기 전용이 아님');
  expect(await page.locator('[data-act="rule-save"]:visible, form[data-pol] [type="submit"]:visible').count() === 0, '감사자에게 저장 버튼이 보임');
  expect(await page.locator('#mtest').count() === 0, '감사자에게 시험 입력이 보임');
  await page.goto(`${BASE}/app#/admin/audit`);
  await page.waitForSelector('#au-act');
});

await browser.close();
console.log(results.join('\n'));
console.log('예상한 400 응답:', expected400.join(', ') || '없음');
console.log(errors.length ? '\n콘솔·네트워크 오류:\n' + errors.join('\n') : '\n콘솔 오류 없음');
