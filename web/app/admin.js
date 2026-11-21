/* 운영 화면(#/admin). 원칙: 운영자는 내용을 보지 않고 운영한다.
   메타데이터와 집계만 보여 주고, 메모 내용은 "예외 열람"(사유·감사 로그·당사자 통지)으로만 연다.
   탭: 현황판 · 사용자·팀 · 정책 · 연동 · 파이프라인 · 감사 로그 · 신고 · 추적·예외 열람
   감사자는 현황판·정책(읽기 전용)·감사 로그만 본다. 감사자 화면은 운영자 전용 API를 부르지 않는다
   (부르면 서버가 권한 검사 실패로 집계해 경보가 뜬다). */
import {
  api, busy, confirmDialog, emptyState, errorState, esc, fmtDate, fmtDateTime, fmtNum, forbidden, html, icon,
  loading, memoTag, navigate, openDialog, pageHead, platformName, raw, registerScreen, render, state, table, timeAgo, toast,
} from './core.js';

await new Promise((res) => {
  if (document.querySelector('link[data-admin-css]')) return res();
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/app/admin.css';
  l.dataset.adminCss = '';
  l.onload = l.onerror = () => res();
  document.head.append(l);
});

const OP = 'operator';
const AUD = 'auditor';
const TABS = [
  { id: 'overview', label: '현황판', roles: [OP, AUD] },
  { id: 'people', label: '사용자·팀', roles: [OP] },
  { id: 'policies', label: '정책', roles: [OP, AUD] },
  { id: 'clients', label: '연동', roles: [OP] },
  { id: 'pipeline', label: '파이프라인', roles: [OP] },
  { id: 'audit', label: '감사 로그', roles: [OP, AUD] },
  { id: 'reports', label: '신고', roles: [OP] },
  { id: 'access', label: '추적·예외 열람', roles: [OP] },
];
const ROLE_LABEL = { user: '개발자', operator: '운영자', auditor: '감사자' };
const TEAM_ROLE = { member: '구성원', admin: '팀 관리자' };
const STAGE_LABEL = { session_extract: '세션 추출', analyze: '메모 분석', topic_summary: '주제 문서 생성' };
const JOB_LABEL = { topic_summary: '주제 문서 생성', reprocess_memo: '메모 재처리', session_extract: '세션 추출', analyze: '메모 분석' };
const JOB_STATUS = { done: '완료', failed: '실패', queued: '대기', running: '실행 중' };
const CMD_LABEL = { 'web:search': '웹 검색', 'web:remember': '웹 저장', mark_used: '쓰임 알림' };
const ACTION_LABEL = {
  login: '로그인', policy_update: '정책 변경', promote: '팀으로 공유', token_create: '토큰 발급', token_revoke: '토큰 회수',
  user_create: '사용자 추가', user_update: '사용자 변경', user_offboard: '퇴사·이동 처리', team_create: '팀 만들기',
  team_member: '팀 구성원 변경', reprocess: '재처리', report_create: '신고', report_resolve: '신고 처리', break_glass: '예외 열람',
  access_denied: '접근 거부', export: '내보내기', delete_my_data: '내 데이터 전체 삭제', capture_pause: '세션 기록 켜기·끄기',
  session_delete: '세션 삭제', import: '가져오기', topic_merge: '주제 합치기',
};
const POLICY_LABEL = { masking_rules: '마스킹 규칙', capture: '수집', retention: '보존 기간', injection: '주입', budget: 'LLM 예산', clients: '클라이언트' };
const isOp = () => state.me?.user.role === OP;
const tabsFor = (role) => TABS.filter((t) => t.roles.includes(role));

// ── 형식·그림 도우미 ───────────────────────────────────────────────
const fmtCompact = (n) => (n >= 10000 ? `${+(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : fmtNum(n));
const fmtMs = (v) => `${v < 10 ? Number(v).toFixed(1) : fmtNum(Math.round(v))}ms`;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const dayLabel = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function scale(max, n = 3) {
  if (!max || max <= 0) return { top: 1, ticks: [0, 1] };
  const step = niceStep(max / n);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}
const w = (v, top) => `${Math.max(0, Math.min(100, (v / top) * 100)).toFixed(2)}%`;

/** 일별 막대. 마지막 칸은 진행 중인 오늘이라 빗금으로 그린다. */
function vbars({ title, meta, series, unit = '', cls = '', small = false }) {
  if (!series?.length) return '';
  const max = Math.max(0, ...series.map((d) => d.value));
  const { top, ticks } = scale(max, small ? 2 : 3);
  const last = series.length - 1;
  const aria = `${title}. ${dayLabel(series[0].day)}부터 오늘까지 ${series.length}일. 가장 많은 날 ${fmtNum(max)}${unit}, 오늘(진행 중) ${fmtNum(series[last].value)}${unit}. ${series.map((d) => `${dayLabel(d.day)} ${d.value}`).join(', ')}`;
  return html`<figure class="vb ${cls} ${small ? 'vb--sm' : ''}">
    <figcaption class="vb__cap"><span class="vb__title">${title}</span>${meta ? html`<span>${meta}</span>` : ''}</figcaption>
    <div class="vb__plot" role="img" aria-label="${aria}">
      ${ticks.map((t) => html`<span class="vb__gl" style="bottom:${w(t, top)}"><span>${fmtCompact(t)}</span></span>`)}
      <div class="vb__cols">${series.map((d, i) => html`<span class="vb__col ${i === last ? 'is-today' : ''}" title="${dayLabel(d.day)}${i === last ? ' 오늘(진행 중)' : ''}: ${fmtNum(d.value)}${unit}"><span class="vb__bar ${d.value ? '' : 'is-zero'}" style="height:${w(d.value, top)}"></span></span>`)}</div>
    </div>
    <div class="vb__x" aria-hidden="true">${series.map((d, i) => html`<span>${i === 0 || i === last - 7 ? dayLabel(d.day) : i === last ? '오늘' : ''}</span>`)}</div>
  </figure>`;
}
/** 가로 막대 비교. rows: [{ label(html|문자열), value, sub, title }] */
function hbars(rows, { fmt = fmtNum, cls = '', caption } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return html`<ul class="hb ${cls}" ${caption ? html`aria-label="${caption}"` : ''}>${rows.map((r) => html`<li class="hb__row">
    <span class="hb__label" title="${r.title || ''}">${r.label}</span>
    <span class="hb__track" aria-hidden="true"><span class="hb__fill" style="width:${w(r.value, max)}"></span></span>
    <span class="hb__val">${fmt(r.value)}${r.sub ? html` <span class="hb__sub">${r.sub}</span>` : ''}</span></li>`)}</ul>`;
}
/** 구성 막대(프레임 포맷 꼴): 눈금 + 칸. fields: [{ label, value, cls, desc, extra }] */
function seg({ fields, unit = '', caption, fmt = fmtNum, ticks = true }) {
  const total = fields.reduce((a, f) => a + f.value, 0);
  const sc = scale(total, 4);
  const shown = fields.filter((f) => f.value > 0);
  return html`<figure class="seg">
    ${ticks && total ? html`<div class="seg__ruler" aria-hidden="true">${sc.ticks.filter((t) => t <= total * 0.9 || t === total).map((t) => html`<span class="seg__tick is-major" style="left:${w(t, total)}"><span>${fmtCompact(t)}</span></span>`)}${sc.ticks.at(-1) !== total ? html`<span class="seg__tick is-major" style="left:100%"><span>${fmtCompact(total)}</span></span>` : ''}</div>` : ''}
    <div class="seg__bar" role="img" aria-label="${caption}: ${total ? fields.map((f) => `${f.label} ${fmt(f.value)}${unit}`).join(', ') : '표본 없음'}" ${ticks && total ? '' : raw('style="border-top: var(--dg-stroke) solid var(--dg-line)"')}>
      ${total ? shown.map((f) => html`<span class="seg__f ${f.cls}" style="flex:0 0 ${w(f.value, total)}" title="${f.label} ${fmt(f.value)}${unit}">${f.value / total > 0.14 ? f.label : ''}</span>`)
        : html`<span class="seg__f is-empty-bar">표본 없음</span>`}
    </div>
    <ul class="seg__legend">${fields.map((f) => html`<li><span class="swatch ${f.cls}" aria-hidden="true"></span>
      <span><strong>${f.label}</strong>${f.desc ? html`<span class="seg__ld">${f.desc}</span>` : ''}</span>
      <span class="seg__lv">${fmt(f.value)}${unit}${total ? html`<small>${pct(f.value, total)}%</small>` : ''}${f.extra || ''}</span></li>`)}</ul>
  </figure>`;
}
/** 비율 한 줄. 분모를 늘 보이고, 표본이 적으면 비율을 내지 않는다. */
function qrow({ name, desc, part, whole, partLabel, wholeLabel, unit = '건', min = 5, warnAt = 0.3 }) {
  const p = whole ? part / whole : 0;
  let right;
  if (!whole) right = html`<span class="q__thin">표본 없음</span><span class="q__meter is-thin" aria-hidden="true"></span>`;
  else if (whole < min) right = html`<span class="q__thin">표본 ${whole}${unit}, 비율은 내지 않습니다</span><span class="q__meter is-thin" aria-hidden="true"></span>`;
  else right = html`<span class="q__pct">${pct(part, whole)}%</span><span class="q__meter ${p >= warnAt ? 'is-warn' : ''}" aria-hidden="true"><i style="width:${w(part, whole)}"></i></span>`;
  return html`<li class="q__row"><div class="q__what"><p class="q__name">${name}</p><p class="q__desc">${desc}</p></div>
    <p class="q__val">${partLabel} <span class="num">${fmtNum(part)}</span>${unit} / ${wholeLabel} <span class="num">${fmtNum(whole)}</span>${unit}</p>
    <div>${right}</div></li>`;
}
function head(id, title, meta, actions) {
  return html`<div class="sec__head"><h2 class="sec__title" id="${id}">${title}</h2>${meta ? html`<span class="sec__meta">${meta}</span>` : ''}${actions || ''}</div>`;
}
const sub = (title, ...meta) => html`<h3 class="adm-h">${title}${meta.filter(Boolean).map((m) => html`<span class="adm-h__meta">${m}</span>`)}</h3>`;
const n = (v) => html`<span class="num">${fmtNum(v)}</span>`;
function chipRole(role) {
  return html`<span class="chip ${role === OP ? 'chip--hot' : ''}">${ROLE_LABEL[role] || role}</span>`;
}
function fieldError(slot, msg) {
  render(slot, msg ? html`<p class="field__error" role="alert">${icon('alert', 'icon--sm')}<span>${msg}</span></p>` : '');
}

// ── 화면 ────────────────────────────────────────────────────────────
const opts = { nav: 'admin', title: '운영', roles: [OP, AUD], personal: true, group: 'admin' };
registerScreen('/admin', adminScreen, opts);
registerScreen('/admin/:tab', adminScreen, opts);

async function adminScreen(root, ctx) {
  const role = state.me.user.role;
  const mine = tabsFor(role);
  render(root, html`
    <header class="page-head adm-head"><div class="page-head__text"><h1 class="page-title">운영</h1>
      <p class="adm-rule">${icon('shield', 'icon--sm')}<span>이 화면은 <strong>메타데이터와 집계만</strong> 보여 줍니다. 개인 공간의 메모 내용은 예외 열람으로만 열리고, 열면 <strong>감사 로그에 남고 당사자에게 통지</strong>됩니다.</span></p></div>
      <div class="page-head__actions"><span class="chip">${ROLE_LABEL[role]}로 보는 중</span></div></header>
    <nav class="tabs adm-tabs" aria-label="운영 항목">${mine.map((t) => html`<a href="#/admin/${t.id}" data-tab="${t.id}">${t.label}</a>`)}</nav>
    ${role === AUD ? html`<p class="adm-scope">${icon('info', 'icon--sm')}<span>감사자 계정은 현황판, 정책(읽기 전용), 감사 로그만 볼 수 있습니다. 사용자·연동·파이프라인·신고·예외 열람은 운영자 전용입니다.</span></p>` : html`<div class="adm-scope" aria-hidden="true"></div>`}
    <div class="adm-body" id="adm-body"></div>`);
  const body = root.querySelector('#adm-body');
  let ctrl = null;
  ctx.signal.addEventListener('abort', () => ctrl?.abort());

  async function show(c) {
    const id = c.params.tab || 'overview';
    const def = TABS.find((t) => t.id === id);
    root.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    ctrl?.abort();
    ctrl = new AbortController();
    const sig = ctrl.signal;
    document.title = `${def ? def.label + ' · ' : ''}운영 · Conntext`;
    if (!def) {
      render(body, emptyState({ icon: 'alert', title: '없는 운영 화면입니다', body: '주소가 바뀌었거나 잘못 입력됐습니다. 위의 탭에서 고르세요.', action: html`<a class="btn" href="#/admin">현황판으로</a>` }));
      return;
    }
    if (!def.roles.includes(role)) {
      render(body, forbidden(`“${def.label}”은 운영자만 볼 수 있습니다. 감사자는 현황판, 정책, 감사 로그를 볼 수 있습니다.`));
      return;
    }
    render(body, loading());
    try {
      await RENDER[id](body, sig, c);
    } catch (e) {
      if (e?.name === 'AbortError' || sig.aborted) return;
      if (e?.status === 401) return;
      console.warn(e);
      render(body, errorState(e));
    }
  }
  await show(ctx);
  return { update: (c) => show(c) };
}

const RENDER = { overview, people, policies, clients, pipeline, audit, reports, access };

// ── 현황판 ─────────────────────────────────────────────────────────
async function overview(body, sig) {
  const [d, pol] = await Promise.all([
    api('/api/admin/overview', { signal: sig }),
    api('/api/admin/policies', { signal: sig }).catch((e) => (e.name === 'AbortError' ? Promise.reject(e) : null)),
  ]);
  const s = d.system;
  const c = d.cost;
  const q = d.quality;
  const a = d.adoption;
  const crit = d.alerts.filter((x) => x.level === 'crit');
  const warn = d.alerts.filter((x) => x.level === 'warn');
  const info = d.alerts.filter((x) => x.level !== 'crit' && x.level !== 'warn');
  const loud = [...crit, ...warn];
  const at = fmtDateTime(d.generated_at).slice(11);
  render(body, html`
    ${loud.length ? html`<section class="adm-alerts" aria-label="경보 ${loud.length}건">
        ${loud.map((x) => html`<div class="alert ${x.level === 'crit' ? 'alert--danger' : 'alert--warn'}" role="${x.level === 'crit' ? 'alert' : 'status'}">${icon('alert')}<div>
          <p class="alert__title"><span class="adm-lvl">${x.level === 'crit' ? '긴급' : '주의'}</span>${x.title}</p><p>${x.text}</p></div></div>`)}
      </section>`
      : html`<p class="adm-calm">${icon('check', 'icon--sm')}<span>이상 없음. 대기열, 실패율, 마스킹, 비용, 권한 검사 모두 기준 안입니다.</span><span class="adm-calm__time">${at} 기준</span>
        <button type="button" class="btn btn--quiet btn--sm" data-act="reload">${icon('refresh', 'icon--sm')}<span>새로 고침</span></button></p>`}
    ${info.length ? html`<ul class="adm-info" aria-label="알림 ${info.length}건">${info.map((x) => html`<li>${icon('info', 'icon--sm')}<span><strong>${x.title}</strong> ${x.text}</span>
        ${x.key === 'reports_open' && isOp() ? html`<a class="btn btn--sm" href="#/admin/reports">신고 보기</a>` : ''}</li>`)}</ul>` : ''}

    <section class="sec" aria-labelledby="h-sys">
      ${head('h-sys', '시스템', '응답 시간은 지난 7일, 실패와 대기열은 지난 24시간입니다.')}
      <div class="adm-cols">
        <div class="adm-col">${sub('응답 시간', 'p50 · p95, 지난 7일')}${latency(s)}</div>
        <div class="adm-col">
          <div>${sub('처리 대기열과 실패', '24시간')}
            <dl class="facts">
              <div><dt>대기열</dt><dd><span>대기 ${n(s.queue.queued)} · 실행 중 ${n(s.queue.running)} · 가장 오래 기다린 작업 ${n(s.queue.lag_seconds)}초</span></dd></div>
              <div><dt>작업</dt><dd><span><span class="${s.queue.failed_24h ? 'danger-text' : ''}">실패 ${n(s.queue.failed_24h)}</span> / 끝난 작업 ${n(s.queue.done_24h + s.queue.failed_24h)}</span></dd></div>
              <div><dt>훅 호출</dt><dd><span><span class="${s.hook_fail_24h ? 'danger-text' : ''}">실패 ${n(s.hook_fail_24h)}</span> / 호출 ${n(s.hook_calls_24h)}</span></dd></div>
              <div><dt>LLM 호출</dt><dd><span><span class="${s.llm_fail_24h ? 'danger-text' : ''}">실패 ${n(s.llm_fail_24h)}</span> / 호출 ${n(s.llm_calls_24h)}${s.llm_calls_24h < 5 ? html` <span class="muted">(표본 적음)</span>` : ''}</span></dd></div>
            </dl></div>
          <div>${sub('처리 엔진')}
            <dl class="facts">
              <div><dt>LLM 공급자</dt><dd>${s.llm_model} <span class="chip chip--mono">${s.llm_provider}</span></dd></div>
              <div><dt>파이프라인 버전</dt><dd><span class="chip chip--mono">${s.pipeline_version}</span>${isOp() ? html`<a href="#/admin/pipeline">옛 버전 결과물 보기</a>` : ''}</dd></div>
            </dl>
            ${s.llm_provider === 'heuristic' ? html`<p class="adm-note">지금은 LLM 없이 규칙으로 분류·추출합니다. 아래 비용 그림은 LLM을 썼던 기간의 기록입니다.</p>` : ''}</div>
        </div>
      </div>
    </section>

    <section class="sec" aria-labelledby="h-cost">
      ${head('h-cost', '비용', html`지난 7일 LLM 토큰 <span class="num-strong">${fmtNum(c.tokens_7d)}</span> · 예산 초과 <span class="num-strong">${fmtNum(c.budget_exceeded_7d)}</span>회${pol ? html` · 하루 한도 사용자당 ${fmtNum(pol.budget.daily_tokens_per_user)} 토큰` : ''}`)}
      <div class="adm-cols">
        <div class="adm-col">${vbars({ title: '일별 LLM 토큰', meta: `14일 · 빗금은 진행 중인 오늘`, series: c.daily, unit: ' 토큰' })}
          <p class="adm-note">${costNote(c.daily)}</p></div>
        <div class="adm-col">
          <div>${sub('단계별 토큰', '지난 7일')}
            ${seg({
              caption: '단계별 토큰', unit: '',
              fields: c.stages.map((st, i) => ({
                label: STAGE_LABEL[st.name] || st.name, value: (st.tin || 0) + (st.tout || 0), cls: ['fill-ink', 'fill-team-soft', 'fill-mine-soft', 'fill-hatch'][i % 4],
                desc: `호출 ${fmtNum(st.calls)}번 · 한 번에 평균 ${fmtNum(Math.round(((st.tin || 0) + (st.tout || 0)) / Math.max(1, st.calls)))} 토큰 · 입력 ${fmtCompact(st.tin || 0)} / 출력 ${fmtCompact(st.tout || 0)}`,
              })),
            })}</div>
          <div>${sub('사용자별 토큰', '지난 7일, 많이 쓴 순')}
            ${c.by_user.length ? hbars(c.by_user.map((u) => ({ label: u.name, value: u.tokens || 0 })), { fmt: fmtCompact, caption: '사용자별 토큰' }) : html`<p class="quiet-line">LLM을 쓴 사용자가 없습니다.</p>`}</div>
        </div>
      </div>
    </section>

    <section class="sec" aria-labelledby="h-q">
      ${head('h-q', '품질', '내용을 보지 않고 품질을 판단하는 숫자입니다. 각 줄의 설명은 그 값이 높을 때 의심할 문제입니다. 지난 7일 기준.')}
      <ul class="q">
        ${qrow({ name: '저장 후 되돌림', desc: '높으면 저장 판단(대체·중복·분류)이 틀렸거나, 사용자가 의도와 다르게 저장하는 일이 잦다는 뜻입니다.', part: q.undo_7d, whole: q.remember_7d, partLabel: '되돌림', wholeLabel: '저장' })}
        ${qrow({ name: '직접 적은 메모의 삭제', desc: '높으면 적고 나서 곧 틀렸다고 판단되는 메모가 많습니다. 범위·종류 판단을 의심해 볼 만합니다.', part: q.manual_deleted_7d, whole: q.manual_7d, partLabel: '삭제', wholeLabel: '직접 적음' })}
        ${qrow({ name: '직접 적은 메모의 수정(대체)', desc: '새 메모가 옛 메모를 대체한 비율입니다. 높으면 같은 내용을 고쳐 적는 일이 잦아 처음 저장이 불완전하다는 뜻입니다.', part: q.manual_superseded_7d, whole: q.manual_7d, partLabel: '대체', wholeLabel: '직접 적음' })}
        ${qrow({ name: '검색 결과 없음', desc: '높으면 사람들이 찾는 말과 메모·주제 문서의 말이 어긋납니다. 색인과 주제 이름을 볼 때입니다.', part: q.zero_result_7d, whole: q.searches_7d, partLabel: '결과 없음', wholeLabel: '검색', warnAt: 0.2 })}
        ${qrow({ name: '주입했지만 쓰이지 않은 메모', desc: '세션 시작 때 넣었는데 에이전트가 답에 썼다고 알리지 않은 메모입니다. 높으면 주입 내용이 일과 맞지 않아 토큰만 씁니다. 에이전트가 쓰임을 알리지 않는 플랫폼에서는 실제보다 높게 나옵니다.', part: q.injected_memos_7d - q.injected_used_7d, whole: q.injected_memos_7d, partLabel: '안 쓰임', wholeLabel: '주입한 메모', unit: '개', warnAt: 0.8 })}
        ${qrow({ name: '검색으로 찾은 메모의 쓰임', desc: '검색에 걸린 메모 가운데 답에 쓰인 것입니다. 낮으면 검색 순위가 엉뚱한 메모를 올리고 있다는 뜻입니다.', part: q.used_memos_7d, whole: q.recalled_memos_7d, partLabel: '쓰임', wholeLabel: '검색에 걸린 메모', unit: '개', warnAt: 2 })}
        <li class="q__row"><div class="q__what"><p class="q__name">분석 방식: 규칙 대 LLM</p><p class="q__desc">LLM이 꺼져 있거나 실패·예산 초과면 규칙 비율이 올라갑니다. 규칙 판단은 대체·중복을 덜 잡습니다.</p></div>
          <p class="q__val">규칙 ${n(q.analyze_by_rule_7d)}건 / LLM ${n(q.analyze_by_llm_7d)}건</p>
          <div>${q.analyze_by_rule_7d + q.analyze_by_llm_7d ? html`<span class="q__pct">규칙 ${pct(q.analyze_by_rule_7d, q.analyze_by_rule_7d + q.analyze_by_llm_7d)}%</span>
            <span class="q__split" aria-hidden="true"><i class="fill-ink" style="width:${w(q.analyze_by_rule_7d, q.analyze_by_rule_7d + q.analyze_by_llm_7d)}"></i><i class="fill-team-soft" style="flex:1"></i></span>` : html`<span class="q__thin">표본 없음</span>`}</div></li>
        <li class="q__row"><div class="q__what"><p class="q__name">마스킹</p><p class="q__desc">저장 전에 가린 비밀·개인정보 건수입니다. 갑자기 늘면 비밀이 대량으로 들어오고 있다는 뜻이고, 0이 오래 이어지면 규칙이 실제 형식을 못 잡는지 정책 탭에서 시험해 보세요.</p></div>
          <p class="q__val">지난 24시간 ${n(q.masked_24h)}건</p><div></div></li>
      </ul>
      <div class="adm-cols" style="margin-top: var(--s-5)">
        <div class="adm-col">${sub('세션 추출 후보의 행방', `지금까지 후보 ${fmtNum(q.candidates.n)}건`)}
          ${candidates(q.candidates)}</div>
        <div class="adm-col"><p class="adm-note">대기가 쌓이고 승격이 적으면 사용자가 후보를 확인하지 않는다는 뜻입니다. 버림이 많으면 추출 품질이 낮고, 만료가 많으면 후보가 쓸모없거나 확인 동선이 묻혀 있습니다.</p></div>
      </div>
    </section>

    <section class="sec" aria-labelledby="h-ad">
      ${head('h-ad', '정착', html`유효 메모 ${n(a.totals.memos)} · 팀 메모 ${n(a.totals.team_memos)} · 주제 문서 ${n(a.totals.topics)} · 세션 ${n(a.totals.sessions)}`)}
      <div class="adm-cols">
        <div class="adm-col">
          <p class="headline">지난 7일 동안 사용자 <span class="num">${fmtNum(a.users)}</span>명 중 <span class="num">${fmtNum(a.active_7d)}</span>명이 메모를 저장하거나 세션을 시작했습니다.</p>
          ${vbars({ title: '일별 직접 적은 메모', meta: '직접 적음 + 가져옴', series: a.memos_daily, unit: '건', cls: 'vb--mine', small: true })}
          ${vbars({ title: '일별 세션 시작 주입', series: a.injections_daily, unit: '번', small: true })}
        </div>
        <div class="adm-col">
          <div>${sub('명령어별 사용', '지난 7일')}${a.commands.length ? hbars(a.commands.map((x) => ({ label: CMD_LABEL[x.name] ? html`${CMD_LABEL[x.name]}` : html`<span class="mono">/${x.name}</span>`, value: x.n, title: x.name })), { caption: '명령어별 사용 횟수' }) : html`<p class="quiet-line">기록된 명령어가 없습니다.</p>`}</div>
          <div>${sub('플랫폼별 세션', '지난 30일')}${a.platforms.length ? hbars(a.platforms.map((x) => ({ label: platformName(x.platform), value: x.n })), { caption: '플랫폼별 세션 수' }) : html`<p class="quiet-line">세션이 없습니다.</p>`}</div>
          <div>${sub('많이 참조된 팀 주제', '지난 30일 검색·쓰임')}
            ${a.team_topics.length ? html`<ol class="rank">${a.team_topics.map((t) => html`<li><span class="rank__t">${t.title}<span class="rank__team">${t.team}</span></span><span class="rank__n ${t.refs ? '' : 'is-zero'}">${t.refs ? `${fmtNum(t.refs)}회` : '없음'}</span></li>`)}</ol>`
              : html`<p class="quiet-line">팀 주제가 없습니다.</p>`}</div>
        </div>
      </div>
    </section>`);
  body.querySelector('[data-act="reload"]')?.addEventListener('click', (e) => busy(e.currentTarget, () => overview(body, sig)));
}
function costNote(daily) {
  const past = daily.slice(0, -1).map((d) => d.value);
  if (!past.some(Boolean)) return '지난 14일 동안 LLM 토큰을 쓰지 않았습니다.';
  const avg = past.reduce((x, y) => x + y, 0) / past.length;
  const mx = Math.max(...past);
  const peak = daily[past.indexOf(mx)];
  return `오늘을 뺀 13일 평균 하루 ${fmtNum(Math.round(avg))} 토큰, 가장 많은 날은 ${dayLabel(peak.day)}의 ${fmtNum(mx)} 토큰입니다. 오늘이 평균의 2.5배를 넘고 2만 토큰 이상이면 비용 이상치 경보가 뜹니다.`;
}
function latency(s) {
  const ops = [['inject', '세션 시작 주입'], ['recall', '검색'], ['ingest', '저장']];
  const max = Math.max(...ops.map(([k]) => s[k].p95 || 0));
  const { top, ticks } = scale(max || 1, 4);
  return html`<div class="lat">
    <div class="lat__row lat__axis" aria-hidden="true"><span></span><div class="lat__scale">${ticks.map((t) => html`<span class="lat__tick" style="left:${w(t, top)}"><span>${fmtNum(t)}</span></span>`)}</div><span class="lat__val muted">ms</span></div>
    ${ops.map(([k, label]) => {
      const v = s[k];
      return html`<div class="lat__row"><span class="lat__name">${label}<span class="lat__n">표본 ${fmtNum(v.n)}</span></span>
        ${v.n ? html`<div class="lat__plot" role="img" aria-label="${label} p50 ${v.p50}ms, p95 ${v.p95}ms">${ticks.map((t) => html`<span class="lat__grid" style="left:${w(t, top)}"></span>`)}
            <span class="lat__p50" style="width:${w(v.p50, top)}"></span><span class="lat__p95" style="left:${w(v.p50, top)};width:calc(${w(v.p95, top)} - ${w(v.p50, top)})"></span></div>
          <span class="lat__val"><b>p50</b>${fmtMs(v.p50)} <b>p95</b>${fmtMs(v.p95)}</span>`
        : html`<span class="muted small">표본 없음</span><span></span>`}</div>`;
    })}
    <p class="lat__legend"><span><i class="lat__key" aria-hidden="true"></i>p50까지</span><span><i class="lat__key lat__key--95" aria-hidden="true"></i>p50에서 p95까지</span><span>세션 시작 주입 p95가 800ms를 넘으면 경보가 뜹니다.</span></p>
  </div>`;
}
function candidates(cd) {
  const other = Math.max(0, cd.n - cd.promoted - cd.expired - cd.dismissed - cd.pending);
  return seg({
    caption: '세션 추출 후보의 행방', unit: '건', ticks: false,
    fields: [
      { label: '정식 승격', value: cd.promoted, cls: 'fill-mine', desc: '사용자가 확인했거나 쓰임이 쌓여 정식 메모가 됨' },
      { label: '대기', value: cd.pending, cls: 'fill-cand', desc: '아직 확인 전. 에이전트 기본 동작에는 들어가지 않음' },
      { label: '만료', value: cd.expired, cls: 'fill-hatch', desc: '보존 기간 안에 확인되지 않아 사라짐' },
      { label: '버림', value: cd.dismissed, cls: 'fill-sunken', desc: '사용자가 틀렸다고 버림' },
      ...(other ? [{ label: '그 밖', value: other, cls: 'fill-line', desc: '삭제, 대체, 진행 상태로 바뀐 것 등' }] : []),
    ],
  });
}

// ── 사용자·팀 ──────────────────────────────────────────────────────
async function people(body, sig) {
  let users;
  let teams;
  let toks;
  async function load() {
    const [u, t, c] = await Promise.all([api('/api/admin/users', { signal: sig }), api('/api/admin/teams', { signal: sig }), api('/api/admin/clients', { signal: sig })]);
    users = u.users;
    teams = t.teams;
    toks = c.tokens;
  }
  await load();
  const me = state.me.user.id;
  const active = () => users.filter((u) => !u.deactivated_at);

  function paint(focusSel) {
    const off = users.filter((u) => u.deactivated_at).length;
    render(body, html`
      <section class="sec" aria-labelledby="h-users">
        ${head('h-users', html`사용자 <span class="sec__count">${active().length}</span>`, `${off ? `비활성 ${off}명 포함. ` : ''}메모 수와 토큰은 개수만 셉니다. 내용은 여기서 볼 수 없습니다.`,
          html`<button type="button" class="btn btn--primary btn--sm" data-act="add-user">${icon('plus', 'icon--sm')}<span>사용자 추가</span></button>`)}
        ${table({
          caption: '사용자',
          columns: [
            { label: '사용자', cell: (u) => html`<span class="td-who"><strong>${u.name}</strong><small>${u.email}</small></span>` },
            { label: '역할', cell: (u) => chipRole(u.role) },
            { label: '내 공간 메모', num: true, cell: (u) => fmtNum(u.memos) },
            { label: '마지막 활동', cell: (u) => (u.last_active ? timeAgo(u.last_active) : html`<span class="muted">없음</span>`) },
            { label: '24시간 토큰', num: true, cell: (u) => html`${fmtNum(u.tokens_24h)}${u.llm_budget_tokens ? html`<br><small class="muted">한도 ${fmtNum(u.llm_budget_tokens)}</small>` : ''}` },
            { label: '팀', cell: (u) => (u.teams.length ? html`<span class="td-chips">${u.teams.map((t) => html`<span class="chip">${t}</span>`)}</span>` : html`<span class="muted">없음</span>`) },
            { label: '상태', cell: (u) => html`<span class="td-chips">${u.deactivated_at ? html`<span class="chip">비활성 ${fmtDate(u.deactivated_at)}</span>` : html`<span class="chip chip--state">활성</span>`}${u.capture_paused ? html`<span class="chip chip--warn">기록 꺼짐</span>` : ''}</span>` },
            { label: '', cls: 'td-acts', cell: (u) => (u.deactivated_at ? '' : html`<button type="button" class="btn btn--sm" data-edit="${u.id}" aria-label="${u.name} 역할·한도 바꾸기">설정</button><button type="button" class="btn btn--quiet btn--sm danger-text" data-off="${u.id}" ${u.id === me ? raw('disabled title="자기 자신은 처리할 수 없습니다"') : ''} aria-label="${u.name} 퇴사·이동 처리">퇴사·이동</button>`) },
          ],
          rows: users,
          rowAttrs: (u) => (u.deactivated_at ? html`class="is-off"` : ''),
        })}
      </section>
      <section class="sec" aria-labelledby="h-teams">
        ${head('h-teams', html`팀 <span class="sec__count">${teams.length}</span>`, '오래된 주제는 90일 넘게 갱신되지 않은 주제 문서, 담당자가 떠난 메모는 작성자가 비활성인 팀 메모입니다.')}
        <form class="inline-form" id="team-new" style="margin-bottom: var(--s-5)">
          <div class="field"><label class="field__label" for="tn-name">새 팀 이름</label><input class="input" id="tn-name" maxlength="60" placeholder="예: 플랫폼 파트"><div id="tn-err"></div></div>
          <button type="submit" class="btn">${icon('plus', 'icon--sm')}<span>팀 만들기</span></button>
        </form>
        ${teams.length ? teams.map(teamBlock) : emptyState({ icon: 'team', title: '팀이 없습니다', body: '팀을 만들면 구성원이 팀 공간에 메모를 공유할 수 있습니다.' })}
      </section>`);
    if (focusSel) body.querySelector(focusSel)?.focus();
  }
  function teamBlock(t) {
    const ids = new Set(t.members.map((m) => m.id));
    const cand = active().filter((u) => !ids.has(u.id));
    return html`<div class="team" aria-labelledby="team-${t.id}">
      <div class="team__head"><h3 class="team__name" id="team-${t.id}">${t.name}</h3>
        <p class="team__facts"><span>구성원 ${n(t.members.length)}</span><span>메모 ${n(t.memos)}</span><span>주제 ${n(t.topics)}</span>
          <span class="${t.stale_topics ? 'warn-text' : ''}">오래된 주제 ${n(t.stale_topics)}</span><span class="${t.orphaned ? 'warn-text' : ''}">담당자가 떠난 메모 ${n(t.orphaned)}</span></p></div>
      ${t.members.length ? table({
        caption: `${t.name} 구성원`,
        columns: [
          { label: '구성원', cell: (m) => html`<span class="td-who"><strong>${m.name}</strong><small>${m.email}</small></span>` },
          { label: '팀 역할', cell: (m) => html`<label class="sr-only" for="tr-${t.id}-${m.id}">${m.name}의 ${t.name} 역할</label><select class="select td-select" id="tr-${t.id}-${m.id}" data-team="${t.id}" data-user="${m.id}" data-was="${m.role}">${Object.entries(TEAM_ROLE).map(([k, v]) => html`<option value="${k}" ${k === m.role ? 'selected' : ''}>${v}</option>`)}</select><span class="saving" aria-live="polite"></span>` },
          { label: '', cls: 'td-acts', cell: (m) => html`<button type="button" class="btn btn--quiet btn--sm danger-text" data-rm-team="${t.id}" data-rm-user="${m.id}" data-name="${m.name}">팀에서 빼기</button>` },
        ],
        rows: t.members,
      }) : html`<p class="quiet-line">구성원이 없습니다.</p>`}
      ${cand.length ? html`<form class="team__add" data-add-team="${t.id}">
        <div class="field"><label class="field__label" for="ta-u-${t.id}">구성원 추가</label><select class="select" id="ta-u-${t.id}" name="user">${cand.map((u) => html`<option value="${u.id}">${u.name} (${u.email})</option>`)}</select></div>
        <div class="field" style="flex-basis:140px"><label class="field__label" for="ta-r-${t.id}">역할</label><select class="select" id="ta-r-${t.id}" name="role"><option value="member">구성원</option><option value="admin">팀 관리자</option></select></div>
        <button type="submit" class="btn">${icon('plus', 'icon--sm')}<span>추가</span></button></form>` : ''}
    </div>`;
  }
  async function reload(focusSel) {
    await load();
    paint(focusSel);
  }
  const setMember = (teamId, userId, role) => api(`/api/admin/teams/${teamId}/members`, { method: 'PUT', body: { user_id: Number(userId), role } });

  body.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || !body.contains(b)) return;
    if (b.dataset.act === 'add-user') addUser(reload);
    else if (b.dataset.edit) editUser(users.find((u) => u.id === Number(b.dataset.edit)), reload);
    else if (b.dataset.off) offboardDialog(users.find((u) => u.id === Number(b.dataset.off)), users, teams, toks, reload);
    else if (b.dataset.rmTeam) {
      const t = teams.find((x) => x.id === Number(b.dataset.rmTeam));
      const ok = await confirmDialog({ title: `${b.dataset.name} 님을 ${t.name}에서 뺄까요`, body: '팀 공간의 메모와 주제 문서를 더 볼 수 없고, 다음 세션부터 팀 지식이 주입되지 않습니다. 이 사람이 쓴 팀 메모는 팀에 남습니다. 다시 추가하면 되돌릴 수 있습니다.', confirmLabel: '팀에서 빼기', danger: true });
      if (!ok) return;
      await busy(b, async () => {
        await setMember(t.id, b.dataset.rmUser, null);
        toast(`${b.dataset.name} 님을 ${t.name}에서 뺐습니다.`);
        await reload();
      });
    }
  };
  body.onchange = async (e) => {
    const sel = e.target.closest('select[data-team]');
    if (!sel) return;
    const was = sel.dataset.was;
    const role = sel.value;
    const note = sel.nextElementSibling;
    sel.disabled = true;
    note.textContent = '저장 중';
    try {
      await setMember(sel.dataset.team, sel.dataset.user, role);
      const t = teams.find((x) => x.id === Number(sel.dataset.team));
      const name = t.members.find((m) => m.id === Number(sel.dataset.user))?.name;
      await reload(`#${sel.id}`);
      toast(`${name} 님의 ${t.name} 역할을 ${TEAM_ROLE[role]}(으)로 바꿨습니다.`, {
        action: { label: '되돌리기', run: async () => { await setMember(t.id, sel.dataset.user, was); toast('역할을 되돌렸습니다.'); await reload(); } },
      });
    } catch (err) {
      sel.value = was;
      sel.disabled = false;
      note.textContent = '저장 실패';
      toast(`역할을 바꾸지 못했습니다. ${err.message}`, { tone: 'error' });
    }
  };
  body.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'team-new') {
      const inp = f.querySelector('#tn-name');
      const name = inp.value.trim();
      if (!name) {
        inp.setAttribute('aria-invalid', 'true');
        fieldError(f.querySelector('#tn-err'), '팀 이름을 적으세요.');
        inp.focus();
        return;
      }
      await busy(e.submitter, async () => {
        await api('/api/admin/teams', { method: 'POST', body: { name } });
        toast(`“${name}” 팀을 만들었습니다. 구성원을 추가하세요.`);
        await reload();
      });
    } else if (f.dataset.addTeam) {
      const t = teams.find((x) => x.id === Number(f.dataset.addTeam));
      const uid = f.elements.user.value;
      const role = f.elements.role.value;
      await busy(e.submitter, async () => {
        await setMember(t.id, uid, role);
        toast(`${users.find((u) => u.id === Number(uid))?.name} 님을 ${t.name}에 ${TEAM_ROLE[role]}(으)로 추가했습니다.`);
        await reload();
      });
    }
  };
  paint();
}

function addUser(after) {
  openDialog({
    title: '사용자 추가',
    body: html`<p class="pm-lead">사내 계정 이메일로 로그인할 수 있게 합니다. 개인 공간이 함께 만들어지고, 감사 로그에 남습니다.</p>
      <div class="field"><label class="field__label" for="nu-email">이메일</label><input class="input" id="nu-email" type="email" autocomplete="off" placeholder="name@conn.example"></div>
      <div class="field"><label class="field__label" for="nu-name">이름</label><input class="input" id="nu-name" maxlength="40" autocomplete="off"></div>
      <div class="field"><label class="field__label" for="nu-role">역할</label><select class="select" id="nu-role">${Object.entries(ROLE_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
        <p class="field__hint" id="nu-hint">${roleHint('user')}</p></div>
      <div id="nu-err"></div>`,
    actions: [{ label: '취소' }, {
      label: '추가', kind: 'primary', run: async (dlg) => {
        const el = dlg.el;
        const email = el.querySelector('#nu-email');
        const name = el.querySelector('#nu-name');
        [email, name].forEach((x) => x.removeAttribute('aria-invalid'));
        const errs = [];
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) { errs.push('이메일 형식이 올바르지 않습니다(예: name@company.com).'); email.setAttribute('aria-invalid', 'true'); }
        if (!name.value.trim()) { errs.push('이름이 비어 있습니다.'); name.setAttribute('aria-invalid', 'true'); }
        if (errs.length) { fieldError(el.querySelector('#nu-err'), errs.join(' ')); el.querySelector('[aria-invalid="true"]').focus(); return false; }
        try {
          await api('/api/admin/users', { method: 'POST', body: { email: email.value.trim(), name: name.value.trim(), role: el.querySelector('#nu-role').value } });
        } catch (e) {
          fieldError(el.querySelector('#nu-err'), `추가하지 못했습니다. ${e.message}`);
          return false;
        }
        toast(`${name.value.trim()} 님을 추가했습니다.`);
        await after();
        return true;
      },
    }],
    onMount: (dlg) => dlg.el.querySelector('#nu-role').addEventListener('change', (e) => (dlg.el.querySelector('#nu-hint').textContent = roleHint(e.target.value))),
  });
}
function roleHint(r) {
  return {
    user: '개발자: 자기 공간과 속한 팀 공간만 씁니다. 운영 화면은 보이지 않습니다.',
    operator: '운영자: 운영 화면 전부와 예외 열람을 쓸 수 있습니다. 꼭 필요한 사람에게만 주세요.',
    auditor: '감사자: 현황판, 정책(읽기 전용), 감사 로그만 봅니다.',
  }[r];
}
function editUser(u, after) {
  openDialog({
    title: `${u.name} 설정`,
    body: html`<p class="pm-lead mono">${u.email}</p>
      <div class="field"><label class="field__label" for="eu-role">역할</label><select class="select" id="eu-role">${Object.entries(ROLE_LABEL).map(([k, v]) => html`<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`)}</select>
        <p class="field__hint" id="eu-hint">${roleHint(u.role)}</p></div>
      <div class="field"><label class="field__label" for="eu-budget">하루 LLM 토큰 한도</label><input class="input" id="eu-budget" type="number" min="0" step="1000" inputmode="numeric" value="${u.llm_budget_tokens ?? ''}" placeholder="비우면 정책 기본값">
        <p class="field__hint">24시간 동안 이만큼 쓰면 이 사람의 분석·추출은 규칙 기반으로 처리됩니다. 비우면 정책의 사용자당 한도를 따릅니다.</p></div>
      <div id="eu-err"></div>`,
    actions: [{ label: '취소' }, {
      label: '저장', kind: 'primary', run: async (dlg) => {
        const el = dlg.el;
        const role = el.querySelector('#eu-role').value;
        const raw = el.querySelector('#eu-budget').value.trim();
        const budget = raw === '' ? null : Number(raw);
        if (budget !== null && (!Number.isFinite(budget) || budget < 0)) { fieldError(el.querySelector('#eu-err'), '한도는 0 이상의 숫자여야 합니다.'); return false; }
        const bodyReq = { llm_budget_tokens: budget };
        if (role !== u.role) bodyReq.role = role;
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: bodyReq });
        } catch (e) {
          fieldError(el.querySelector('#eu-err'), `저장하지 못했습니다. ${e.message}`);
          return false;
        }
        const prev = { role: u.role, llm_budget_tokens: u.llm_budget_tokens };
        toast(role !== u.role ? `${u.name} 님의 역할을 ${ROLE_LABEL[role]}(으)로 바꿨습니다.` : `${u.name} 님의 설정을 저장했습니다.`, {
          action: { label: '되돌리기', run: async () => { await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: prev }); toast('되돌렸습니다.'); await after(); } },
        });
        await after();
        return true;
      },
    }],
    onMount: (dlg) => dlg.el.querySelector('#eu-role').addEventListener('change', (e) => (dlg.el.querySelector('#eu-hint').textContent = roleHint(e.target.value))),
  });
}

function offboardDialog(u, users, teams, toks, after) {
  const liveToks = toks.filter((t) => t.email === u.email && !t.revoked_at).length;
  const myTeams = teams.filter((t) => t.members.some((m) => m.id === u.id));
  const delN = u.personal_memos_to_delete ?? u.memos;
  const teamN = u.team_memos_authored ?? null;
  const heirs = users.filter((x) => !x.deactivated_at && x.id !== u.id);
  const dlg = openDialog({
    title: `${u.name} 퇴사·이동 처리`,
    wide: true,
    body: html`<p class="off__lead">되돌릴 수 없는 처리입니다. 무엇이 지워지고 무엇이 남는지 확인한 뒤 실행하세요.</p>
      <div><p class="pm-h">실행하면 바로</p><ul class="off__now">
        <li>클라이언트 토큰 <span class="num">${liveToks}</span>개를 회수합니다. 이 사람의 에이전트 연결이 끊깁니다.</li>
        <li>${myTeams.length ? html`팀 ${myTeams.map((t) => t.name).join(', ')}에서 뺍니다.` : '속한 팀이 없습니다.'}</li>
        <li>계정을 비활성으로 바꿉니다. 더는 로그인할 수 없습니다.</li></ul></div>
      <fieldset class="off__choice"><legend>개인 공간 (메모 ${fmtNum(delN)}건${delN !== u.memos ? `, 그중 유효 ${fmtNum(u.memos)}건` : ''})</legend>
        <label class="off__opt"><input type="radio" name="personal" value="delete"><strong>지우기</strong>
          <span class="off__opt-d">메모, 주제 문서, 세션 기록과 대화록, 주입·사용 기록, 알림을 영구 삭제합니다.</span></label>
        <label class="off__opt"><input type="radio" name="personal" value="keep"><strong>보관</strong>
          <span class="off__opt-d">데이터를 그대로 둡니다. 운영자도 예외 열람 없이는 볼 수 없습니다.</span></label></fieldset>
      <div class="field"><label class="field__label" for="off-heir">팀 메모 담당자 넘기기${teamN !== null ? ` (팀 공간에 쓴 메모 ${fmtNum(teamN)}건)` : ''}</label>
        <select class="select" id="off-heir"><option value="">넘기지 않음</option>${heirs.map((x) => html`<option value="${x.id}">${x.name} (${x.email})</option>`)}</select>
        <p class="field__hint">이 사람이 팀 공간에 쓴 메모의 담당자를 바꿉니다. 넘기지 않으면 팀 탭에서 “담당자가 떠난 메모”로 셉니다.</p></div>
      <div class="off__ledger" id="off-ledger" aria-live="polite"></div>
      <div class="field dlg__confirm"><label class="field__label" for="off-type">확인을 위해 이메일 <strong class="mono">${u.email}</strong>을 입력하세요</label>
        <input class="input input--mono" id="off-type" autocomplete="off" spellcheck="false"></div>
      <div id="off-err"></div>`,
    actions: [{ label: '취소' }, {
      label: '퇴사 처리 실행', kind: 'danger', run: async (d) => {
        const el = d.el;
        const personal = el.querySelector('input[name="personal"]:checked')?.value;
        const heir = el.querySelector('#off-heir').value;
        try {
          const r = await api(`/api/admin/users/${u.id}/offboard`, { method: 'POST', body: { personal, reassign_to: heir ? Number(heir) : null } });
          toast(`${u.name} 님을 처리했습니다. ${personal === 'delete' ? `개인 메모 ${fmtNum(r.deleted_memos)}건을 지웠고, ` : '개인 공간은 보관했고, '}팀 메모 ${fmtNum(r.reassigned_team_memos)}건의 담당자를 넘겼습니다.`);
        } catch (e) {
          fieldError(el.querySelector('#off-err'), `처리하지 못했습니다. ${e.message}`);
          return false;
        }
        await after();
        return true;
      },
    }],
  });
  const el = dlg.el;
  const go = el.querySelector('[data-dlg-act="1"]');
  const update = () => {
    const personal = el.querySelector('input[name="personal"]:checked')?.value;
    const heirSel = el.querySelector('#off-heir');
    const heirName = heirSel.value ? heirSel.selectedOptions[0].textContent.split(' (')[0] : null;
    const gone = [`클라이언트 토큰 ${liveToks}개(회수)`, ...(myTeams.length ? [`팀 구성원 자격 ${myTeams.length}곳`] : [])];
    const teamLine = teamN === 0 ? '팀 공간에 쓴 메모 없음' : `팀 공간에 쓴 메모${teamN !== null ? ` ${fmtNum(teamN)}건` : ''}${heirName ? `: 담당자가 ${heirName} 님으로 바뀜` : ': 담당자가 떠난 메모로 남음'}`;
    const kept = ['계정 기록(비활성)과 감사 로그', teamLine];
    const memoLine = `개인 메모 ${fmtNum(delN)}건${delN !== u.memos ? '(삭제·대체된 판 포함)' : ''}`;
    if (personal === 'delete') gone.push(`${memoLine}과 주제 문서, 세션 기록, 대화록, 알림`);
    else if (personal === 'keep') kept.push(`${memoLine}과 주제 문서, 세션 기록(열람하지 않음)`);
    render(el.querySelector('#off-ledger'), html`
      <div class="off__gone"><h3>${icon('trash', 'icon--sm')}지워지는 것</h3><ul>${gone.map((x) => html`<li>${x}</li>`)}</ul></div>
      <div class="off__kept"><h3>${icon('check', 'icon--sm')}남는 것</h3><ul>${kept.map((x) => html`<li>${x}</li>`)}${personal ? '' : html`<li class="off__none">개인 공간을 지울지 보관할지 고르세요.</li>`}</ul></div>`);
    go.disabled = !personal || el.querySelector('#off-type').value.trim() !== u.email;
  };
  el.addEventListener('input', update);
  el.addEventListener('change', update);
  update();
  el.querySelector('input[name="personal"]').focus();
}

// ── 정책 ────────────────────────────────────────────────────────────
const PFORMS = [
  { key: 'retention', title: '보존 기간', meta: '정해진 기간이 지나면 다음 정리 때 지웁니다.', fields: [
    { k: 'transcript_days', label: '대화록 보존', unit: '일', min: 1, hint: '세션 대화록을 서버에 두는 기간입니다. 줄이면 세션 상세에서 원문을 더 일찍 못 보게 됩니다.' },
    { k: 'candidate_days', label: '확인 안 한 후보 보존', unit: '일', min: 1, hint: '세션에서 뽑은 후보를 이 기간 안에 확인하지 않으면 만료됩니다. 줄이면 만료 비율이 올라갑니다.' },
    { k: 'state_days', label: '진행 상태 보존', unit: '일', min: 1, hint: '“이어서 할 일”을 이 기간 동안 다음 세션에 넣습니다.' },
    { k: 'candidate_promote_uses', label: '후보 자동 승격에 필요한 사용', unit: '회', min: 1, hint: '후보가 이만큼 답에 쓰이면 확인 없이 정식 메모가 됩니다. 낮추면 확인되지 않은 내용이 기본 동작에 더 빨리 들어갑니다.' },
  ] },
  { key: 'injection', title: '주입', meta: '세션을 시작할 때 에이전트에 넣는 양입니다.', fields: [
    { k: 'token_budget', label: '토큰 예산', unit: '토큰', min: 100, step: 100, hint: '늘리면 맥락이 많아지는 대신 모든 세션의 첫 요청이 그만큼 길어집니다. 넘는 항목은 빠집니다.' },
    { k: 'max_instructions', label: '지시·선호 최대 수', unit: '개', min: 0, hint: '항상 적용되는 지시·선호를 몇 개까지 넣을지 정합니다.' },
    { k: 'max_topics', label: '주제 색인 최대 수', unit: '개', min: 0, hint: '색인에 넣을 내 주제 수의 상한입니다. 색인은 제목만 넣으므로 보통은 토큰 예산이 먼저 개수를 정합니다. 팀 주제는 이 값의 절반(최소 3)까지 넣습니다.' },
  ] },
  { key: 'budget', title: 'LLM 예산', meta: '분석·추출·주제 문서 생성에 쓰는 LLM 토큰입니다.', fields: [
    { k: 'daily_tokens_per_user', label: '사용자당 하루 토큰', unit: '토큰', min: 0, step: 1000, hint: '사용자 한 명이 최근 24시간 동안 쓸 수 있는 LLM 토큰입니다. 사용자별 한도가 있으면 그것이 먼저입니다. 0이면 제한하지 않습니다.' },
  ], static: () => html`<p class="pol-static">넘었을 때: 최근 24시간 사용량이 예산을 넘은 사용자는, 다시 예산 아래로 내려갈 때까지 규칙 기반으로 처리합니다. 이 동작은 바꿀 수 없습니다.</p>` },
  { key: 'capture', title: '수집', meta: '세션 대화록을 서버로 올리는 조건입니다.', fields: [
    { k: 'platforms', label: '허용 플랫폼', type: 'platforms', hint: '빼면 그 플랫폼의 세션은 대화록을 올리지 않고 후보·진행 상태도 만들지 않습니다. 주입은 계속됩니다.' },
    { k: 'excluded_projects', label: '제외 저장소', type: 'lines', hint: '저장소 주소에 이 글자가 들어가면 대화록을 올리지 않습니다. 한 줄에 하나씩.' },
    { k: 'max_transcript_chars', label: '대화록 최대 길이', unit: '자', min: 1000, step: 1000, hint: '이보다 긴 대화록은 잘라서 올립니다. 줄이면 저장 공간과 추출 비용이 줄고, 긴 세션의 일부 맥락이 빠집니다.' },
  ] },
  { key: 'clients', title: '클라이언트', meta: '플러그인 버전 관리입니다.', fields: [
    { k: 'min_plugin_version', label: '최소 버전', type: 'version', hint: '이보다 낮은 플러그인은 사용자 설정 화면과 연동 탭에 “업데이트 필요”로 표시됩니다.' },
  ] },
];
const PLATFORMS = ['claude-code', 'opencode', 'connpass'];
const SAMPLE = 'AWS 키 AKIAIOSFODNN7EXAMPLE 로 배포했고, 문의는 010-1234-5678.\npassword = hunter2hunter2\n게이트웨이 재시작 순서는 broker 먼저.';

async function policies(body, sig) {
  const data = await api('/api/admin/policies', { signal: sig });
  const ro = !isOp();
  let saved = data.masking_rules.map((r) => ({ ...r }));
  let rules = saved.map((r) => ({ ...r }));
  const values = Object.fromEntries(PFORMS.map((f) => [f.key, { ...data[f.key] }]));

  render(body, html`
    ${ro ? html`<div class="alert" role="status" style="margin-bottom: var(--s-5)">${icon('info')}<div><p class="alert__title">읽기 전용</p><p>감사자는 정책을 볼 수만 있습니다. 바꾼 기록은 감사 로그의 “정책 변경”에서 확인하세요.</p></div></div>` : ''}
    <section class="sec" aria-labelledby="h-mask">
      ${head('h-mask', html`마스킹 규칙 <span class="sec__count">${rules.length}</span>`, '저장 전에 메모와 대화록에서 이 정규식에 맞는 부분을 가립니다. 가린 원문은 서버에 남지 않습니다. 정규식은 Python 문법입니다.')}
      <div class="pol ${ro ? 'pol-readonly' : ''}">
        <div><div id="mrules"></div>
          <div class="pol-bar"><button type="button" class="btn btn--sm" data-act="rule-add">${icon('plus', 'icon--sm')}<span>규칙 추가</span></button>
            <span class="adm-acts" style="margin-left:auto"><span class="pol-dirty" id="m-dirty" hidden>${icon('edit', 'icon--sm')}저장하지 않은 변경</span>
            <button type="button" class="btn btn--quiet btn--sm" data-act="rule-reset" disabled>변경 취소</button>
            <button type="button" class="btn btn--primary btn--sm" data-act="rule-save" disabled>규칙 저장</button></span></div>
          <div id="m-err" class="pol-err"></div></div>
        ${ro ? '' : html`<form class="mtest" id="mtest" aria-labelledby="mt-h"><p class="mtest__h" id="mt-h">바로 시험해 보기</p>
          <div class="field"><label class="field__label" for="mt-in">시험할 글</label><textarea class="textarea input--mono" id="mt-in" rows="5">${SAMPLE}</textarea>
            <p class="field__hint">왼쪽의 저장하지 않은 규칙으로 시험합니다. 틀린 정규식이 있으면 어느 규칙인지 알려 줍니다. 입력한 글은 저장되지 않습니다.</p></div>
          <button type="submit" class="btn">${icon('shield', 'icon--sm')}<span>시험</span></button>
          <div id="mt-out" aria-live="polite"></div></form>`}
      </div>
    </section>
    <div class="pol-groups">${PFORMS.map((f) => pform(f, values[f.key], ro))}</div>`);

  // 마스킹 규칙 목록
  const list = body.querySelector('#mrules');
  const dirty = () => JSON.stringify(rules) !== JSON.stringify(saved);
  function paintRules(focusLast) {
    render(list, html`<div class="mrule__head" aria-hidden="true"><span>이름</span><span>정규식</span><span></span></div>
      <ol class="mrules">${rules.map((r, i) => html`<li class="mrule ${i >= saved.length ? 'is-new' : ''}">
        <label class="sr-only" for="mr-n-${i}">규칙 ${i + 1} 이름</label><input class="input" id="mr-n-${i}" data-i="${i}" data-f="name" value="${r.name}" ${ro ? 'readonly' : ''} placeholder="예: 사내 API 키">
        <span class="mrule__pat"><label class="sr-only" for="mr-p-${i}">규칙 ${i + 1} 정규식</label><input class="input input--mono" id="mr-p-${i}" data-i="${i}" data-f="pattern" value="${r.pattern}" ${ro ? 'readonly' : ''} spellcheck="false" placeholder="예: conn_[A-Za-z0-9]{32}"></span>
        ${ro ? html`<span></span>` : html`<button type="button" class="btn btn--quiet btn--icon btn--sm" data-del="${i}" aria-label="규칙 ${r.name || i + 1} 삭제">${icon('trash', 'icon--sm')}</button>`}</li>`)}</ol>`);
    syncBar();
    if (focusLast) list.querySelector(`#mr-n-${rules.length - 1}`)?.focus();
  }
  function syncBar() {
    if (ro) return;
    const d = dirty();
    body.querySelector('#m-dirty').hidden = !d;
    body.querySelector('[data-act="rule-reset"]').disabled = !d;
    body.querySelector('[data-act="rule-save"]').disabled = !d;
    body.querySelector('#h-mask .sec__count').textContent = rules.length;
  }
  paintRules();
  if (!ro) {
    list.addEventListener('input', (e) => {
      const t = e.target.closest('[data-i]');
      if (!t) return;
      rules[Number(t.dataset.i)][t.dataset.f] = t.value;
      t.removeAttribute('aria-invalid');
      syncBar();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const i = Number(b.dataset.del);
      rules.splice(i, 1);
      paintRules();
      (list.querySelector(`[data-del="${Math.min(i, rules.length - 1)}"]`) || body.querySelector('[data-act="rule-add"]')).focus();
    });
    body.querySelector('[data-act="rule-add"]').onclick = () => {
      rules.push({ name: '', pattern: '' });
      paintRules(true);
    };
    body.querySelector('[data-act="rule-reset"]').onclick = () => {
      rules = saved.map((r) => ({ ...r }));
      fieldError(body.querySelector('#m-err'), '');
      paintRules();
    };
    body.querySelector('[data-act="rule-save"]').onclick = (e) => saveRules(e.currentTarget);
    body.querySelector('#mtest').onsubmit = async (e) => {
      e.preventDefault();
      const out = body.querySelector('#mt-out');
      list.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
      const idx = rules.map((x, i) => (x.pattern ? i : -1)).filter((i) => i >= 0);
      await busy(e.submitter, async () => {
        let r;
        try {
          r = await api('/api/admin/masking-test', { method: 'POST', body: { text: body.querySelector('#mt-in').value, rules: idx.map((i) => rules[i]) } });
        } catch (ex) {
          if (ex.status !== 400) throw ex;
          const k = /(\d+)번째 규칙/.exec(ex.message);
          const i = k ? idx[Number(k[1]) - 1] : -1;
          render(out, html`<div class="alert alert--danger" role="alert">${icon('alert')}<div><p class="alert__title">시험하지 못했습니다</p><p>${i >= 0 ? `왼쪽 ${i + 1}번째 규칙의 정규식이 틀렸습니다. ` : ''}${ex.message}</p></div></div>`);
          if (i >= 0) list.querySelector(`#mr-p-${i}`)?.setAttribute('aria-invalid', 'true');
          return;
        }
        const marked = esc(r.text).replace(/\[(마스킹: [^\]]+|비공개 처리됨)\]/g, '<mark>[$1]</mark>');
        render(out, html`<p class="mtest__count">${r.count ? html`<span class="num-strong">${r.count}</span>군데를 가렸습니다.` : '가린 곳이 없습니다. 규칙이 이 형식을 잡지 못합니다.'}</p><pre class="mtest__out">${raw(marked)}</pre>`);
      });
    };
  }
  async function saveRules(btn) {
    const err = body.querySelector('#m-err');
    const bad = rules.map((r, i) => (!r.name.trim() ? `n-${i}` : !r.pattern ? `p-${i}` : null)).filter(Boolean);
    if (bad.length) {
      bad.forEach((id) => list.querySelector(`#mr-${id}`).setAttribute('aria-invalid', 'true'));
      fieldError(err, '이름과 정규식을 모두 채워야 저장할 수 있습니다. 빈 칸을 채우거나 그 규칙을 지우세요.');
      list.querySelector(`#mr-${bad[0]}`).focus();
      return;
    }
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      const prev = saved;
      const r = await api('/api/admin/policies/masking_rules', { method: 'PUT', body: { value: rules.map((x) => ({ name: x.name.trim(), pattern: x.pattern })) } });
      saved = r.value.map((x) => ({ ...x }));
      rules = saved.map((x) => ({ ...x }));
      fieldError(err, '');
      paintRules();
      toast(`마스킹 규칙 ${saved.length}개를 저장했습니다. 다음 저장부터 적용됩니다.`, {
        action: { label: '되돌리기', run: async () => {
          const back = await api('/api/admin/policies/masking_rules', { method: 'PUT', body: { value: prev } });
          saved = back.value.map((x) => ({ ...x }));
          rules = saved.map((x) => ({ ...x }));
          paintRules();
          toast('마스킹 규칙을 되돌렸습니다.');
        } },
      });
    } catch (e) {
      render(err, html`<div class="alert alert--danger" role="alert">${icon('alert')}<div><p class="alert__title">저장하지 못했습니다</p><p>${e.message}</p><p>정규식을 고친 뒤 다시 저장하세요. 저장된 규칙은 바뀌지 않았습니다.</p></div></div>`);
      const k = /(\d+)번째 규칙/.exec(e.message);
      const i = k ? Number(k[1]) - 1 : -1;
      if (i >= 0) {
        const inp = list.querySelector(`#mr-p-${i}`);
        inp.setAttribute('aria-invalid', 'true');
        inp.focus();
      }
      syncBar();
    } finally {
      btn.removeAttribute('aria-busy');
      btn.disabled = !dirty();
    }
  }

  // 나머지 정책 양식
  body.querySelectorAll('form[data-pol]').forEach((form) => {
    const def = PFORMS.find((f) => f.key === form.dataset.pol);
    let base = values[def.key];
    const read = () => {
      const v = { ...base };
      for (const f of def.fields) {
        if (f.type === 'platforms') v[f.k] = PLATFORMS.filter((p) => form.querySelector(`[name="${f.k}"][value="${p}"]`).checked);
        else if (f.type === 'lines') v[f.k] = form.elements[f.k].value.split('\n').map((x) => x.trim()).filter(Boolean);
        else if (f.type === 'version') v[f.k] = form.elements[f.k].value.trim();
        else v[f.k] = form.elements[f.k].value === '' ? NaN : Number(form.elements[f.k].value);
      }
      return v;
    };
    const sync = () => {
      const d = JSON.stringify(read()) !== JSON.stringify(base);
      form.querySelector('.pol-dirty').hidden = !d;
      form.querySelector('[data-act="reset"]').disabled = !d;
      form.querySelector('[type="submit"]').disabled = !d;
    };
    if (ro) return;
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.querySelector('[data-act="reset"]').onclick = () => {
      form.replaceWith(Object.assign(document.createElement('div'), { innerHTML: String(pform(def, base, ro)) }).firstElementChild);
      policiesRebind();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = form.querySelector('.pol-err');
      form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
      const v = read();
      const bad = def.fields.filter((f) => (f.type ? (f.type === 'version' ? !/^\d+(\.\d+){0,2}$/.test(v[f.k]) : f.type === 'platforms' ? !v[f.k].length : false) : !Number.isInteger(v[f.k]) || v[f.k] < (f.min ?? 0)));
      if (bad.length) {
        bad.forEach((f) => form.querySelector(`[name="${f.k}"]`)?.setAttribute('aria-invalid', 'true'));
        fieldError(err, bad.map((f) => (f.type === 'version' ? `${f.label}은 0.1.0 꼴로 적으세요.` : f.type === 'platforms' ? '허용 플랫폼을 하나 이상 고르세요.' : `${f.label}은 ${f.min ?? 0} 이상의 정수여야 합니다.`)).join(' '));
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      const prev = base;
      const btn = e.submitter;
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      try {
        const r = await api(`/api/admin/policies/${def.key}`, { method: 'PUT', body: { value: v } });
        base = values[def.key] = r.value;
        fieldError(err, '');
        toast(`${def.title} 정책을 저장했습니다.`, {
          action: { label: '되돌리기', run: async () => {
            const back = await api(`/api/admin/policies/${def.key}`, { method: 'PUT', body: { value: prev } });
            values[def.key] = back.value;
            const cur = body.querySelector(`form[data-pol="${def.key}"]`);
            cur.replaceWith(Object.assign(document.createElement('div'), { innerHTML: String(pform(def, back.value, ro)) }).firstElementChild);
            policiesRebind();
            toast(`${def.title} 정책을 되돌렸습니다.`);
          } },
        });
      } catch (ex) {
        render(err, html`<div class="alert alert--danger" role="alert">${icon('alert')}<div><p class="alert__title">저장하지 못했습니다</p><p>${ex.message}</p><p>저장된 값은 바뀌지 않았습니다. 고친 뒤 다시 저장하세요.</p></div></div>`);
      } finally {
        btn.removeAttribute('aria-busy');
        sync();
      }
    };
    sync();
  });
  function policiesRebind() {
    policies(body, sig);
  }
}
function pform(def, v, ro) {
  const id = `pf-${def.key}`;
  return html`<section class="sec" aria-labelledby="h-${id}">
    ${head(`h-${id}`, def.title, def.meta)}
    <form class="pform" data-pol="${def.key}" novalidate>
      <div class="pform__grid">${def.fields.map((f) => {
        const fid = `${id}-${f.k}`;
        let ctl;
        if (f.type === 'platforms') {
          ctl = html`<fieldset class="pform__plats" style="border:0;padding:0;margin:0"><legend class="field__label">${f.label}</legend>${PLATFORMS.map((p) => html`<label class="check"><input type="checkbox" name="${f.k}" value="${p}" ${v[f.k]?.includes(p) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${platformName(p)}</label>`)}</fieldset>`;
          return html`<div class="field">${ctl}<p class="field__hint">${f.hint}</p></div>`;
        }
        if (f.type === 'lines') ctl = html`<textarea class="textarea input--mono" id="${fid}" name="${f.k}" rows="3" ${ro ? 'readonly' : ''} placeholder="예: github.com/connectivity/secret-infra">${(v[f.k] || []).join('\n')}</textarea>`;
        else if (f.type === 'version') ctl = html`<input class="input input--mono" id="${fid}" name="${f.k}" value="${v[f.k] ?? ''}" ${ro ? 'readonly' : ''} style="max-width:180px" spellcheck="false">`;
        else ctl = html`<span style="display:flex;gap:8px;align-items:center"><input class="input" type="number" inputmode="numeric" id="${fid}" name="${f.k}" value="${v[f.k]}" min="${f.min ?? 0}" step="${f.step || 1}" ${ro ? 'readonly' : ''}><span class="muted small">${f.unit}</span></span>`;
        return html`<div class="field"><label class="field__label" for="${fid}">${f.label}</label>${ctl}<p class="field__hint">${f.hint}</p></div>`;
      })}</div>
      ${def.static ? def.static(v) : ''}
      ${ro ? '' : html`<div class="pol-bar"><span class="pol-dirty" hidden>${icon('edit', 'icon--sm')}저장하지 않은 변경</span>
        <button type="button" class="btn btn--quiet btn--sm" data-act="reset" disabled>변경 취소</button>
        <button type="submit" class="btn btn--primary btn--sm" disabled>저장</button></div>`}
      <div class="pol-err" aria-live="polite"></div>
    </form></section>`;
}

// ── 연동 ────────────────────────────────────────────────────────────
async function clients(body, sig) {
  const d = await api('/api/admin/clients', { signal: sig });
  let showRevoked = false;
  function paint() {
    const live = d.tokens.filter((t) => !t.revoked_at);
    const old = live.filter((t) => t.outdated);
    const never = live.filter((t) => !t.client_version);
    const rows = showRevoked ? d.tokens : live;
    render(body, html`<section class="sec" aria-labelledby="h-cl">
      ${head('h-cl', html`클라이언트 토큰 <span class="sec__count">${live.length}</span>`, html`최소 버전 <span class="chip chip--mono">${d.min_plugin_version}</span> · 최소 버전 미만 <span class="num-strong">${old.length}</span>개 · 아직 연결 안 됨 <span class="num-strong">${never.length}</span>개 · 회수됨 <span class="num-strong">${d.tokens.length - live.length}</span>개`)}
      <div class="filters"><label class="check filters__chk"><input type="checkbox" id="cl-rev" ${showRevoked ? 'checked' : ''}> 회수한 토큰도 보기</label>
        ${isOp() ? html`<a class="btn btn--quiet btn--sm" href="#/admin/policies">최소 버전 바꾸기</a>` : ''}</div>
      ${rows.length ? table({
        caption: '클라이언트 토큰',
        columns: [
          { label: '사용자', cell: (t) => html`<span class="td-who"><strong>${t.user_name}</strong><small>${t.email}</small></span>` },
          { label: '장비 이름', cell: (t) => t.label },
          { label: '토큰', cell: (t) => html`<span class="mono">${t.prefix}…</span>` },
          { label: '플랫폼·버전', cell: (t) => (t.client_platform ? html`${platformName(t.client_platform)} <span class="mono">${t.client_version || ''}</span>${t.outdated && !t.revoked_at ? html` <span class="chip chip--warn">${icon('alert', 'icon--sm')}최소 버전 미만</span>` : ''}` : html`<span class="muted">아직 연결 안 됨</span>`) },
          { label: '발급', cell: (t) => timeAgo(t.created_at) },
          { label: '마지막 사용', cell: (t) => (t.last_used_at ? timeAgo(t.last_used_at) : html`<span class="muted">없음</span>`) },
          { label: '상태', cell: (t) => (t.revoked_at ? html`<span class="chip">회수 ${fmtDate(t.revoked_at)}</span>` : html`<span class="chip chip--state">사용 중</span>`) },
          { label: '', cls: 'td-acts', cell: (t) => (t.revoked_at ? '' : html`<button type="button" class="btn btn--quiet btn--sm danger-text" data-revoke="${t.id}" aria-label="${t.user_name}의 ${t.label} 토큰 회수">회수</button>`) },
        ],
        rows,
        rowAttrs: (t) => (t.revoked_at ? html`class="is-off"` : t.outdated ? html`class="is-warn-row"` : ''),
      }) : emptyState({ icon: 'key', title: '발급된 토큰이 없습니다', body: '사용자가 설정 화면에서 토큰을 발급하면 여기에 보입니다.' })}
    </section>`);
    body.querySelector('#cl-rev').onchange = (e) => { showRevoked = e.target.checked; paint(); body.querySelector('#cl-rev').focus(); };
    body.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
      const t = d.tokens.find((x) => x.id === Number(b.dataset.revoke));
      const ok = await confirmDialog({ title: '토큰을 회수할까요', body: `${t.user_name} 님의 “${t.label}” 토큰을 쓰는 플러그인이 바로 연결이 끊깁니다. 당사자가 새 토큰을 발급해 setup을 다시 해야 합니다. 회수는 감사 로그에 남습니다.`, confirmLabel: '회수', danger: true });
      if (!ok) return;
      await busy(b, async () => {
        await api(`/api/tokens/${t.id}`, { method: 'DELETE', body: {} });
        toast(`${t.user_name} 님의 “${t.label}” 토큰을 회수했습니다.`);
        Object.assign(d, await api('/api/admin/clients', { signal: sig }));
        paint();
      });
    }));
  }
  paint();
}

// ── 파이프라인 ─────────────────────────────────────────────────────
async function pipeline(body, sig) {
  const [p, ov] = await Promise.all([api('/api/admin/pipeline', { signal: sig }), api('/api/admin/overview', { signal: sig }).catch(() => null)]);
  const sum = (rows) => rows.reduce((a, r) => a + r.n, 0);
  const stale = (rows) => rows.filter((r) => r.version !== p.current).reduce((a, r) => a + r.n, 0);
  const memoN = sum(p.memos);
  const topicN = sum(p.topics);
  const counts = { stale: [stale(p.memos), stale(p.topics)], topics: [0, topicN], all: [memoN, topicN] };
  const avg = (name) => {
    const st = ov?.cost.stages.find((x) => x.name === name);
    return st && st.calls ? ((st.tin || 0) + (st.tout || 0)) / st.calls : null;
  };
  const aMemo = avg('analyze');
  const aTopic = avg('topic_summary');
  const verFields = (rows) => rows.map((r) => ({ label: r.version === p.current ? `${r.version} (현재)` : r.version === '없음' ? '버전 기록 없음' : `${r.version} (옛 버전)`, value: r.n, cls: r.version === p.current ? 'fill-ink' : r.version === '없음' ? 'fill-sunken' : 'fill-hatch' }));
  const SCOPES = [
    { id: 'stale', label: '옛 버전만', d: '현재 버전이 아닌 메모를 다시 분석하고, 현재 버전이 아닌 주제 문서를 다시 만듭니다.' },
    { id: 'topics', label: '주제 문서만', d: '모든 주제 문서를 다시 만듭니다. 메모 분석은 그대로 둡니다.' },
    { id: 'all', label: '전부', d: '모든 유효 메모와 주제 문서를 다시 만듭니다. 가장 비쌉니다.' },
  ];
  const estimate = (id) => {
    const [m, t] = counts[id];
    if (aMemo === null && aTopic === null) return null;
    return Math.round(m * (aMemo || 0) + t * (aTopic || 0));
  };
  render(body, html`
    <section class="sec" aria-labelledby="h-pv">
      ${head('h-pv', '버전과 공급자', html`현재 파이프라인 <span class="chip chip--mono">${p.current}</span> · LLM ${p.llm_model} <span class="chip chip--mono">${p.llm_provider}</span> · 임베딩 <span class="chip chip--mono">${p.embed_provider}</span>`)}
      <div class="adm-cols">
        <div class="adm-col">${sub('버전별 유효 메모', `옛 버전 ${fmtNum(counts.stale[0])} / 전체 ${fmtNum(memoN)}`)}${seg({ caption: '버전별 메모', fields: verFields(p.memos), unit: '건' })}</div>
        <div class="adm-col">${sub('버전별 주제 문서', `옛 버전 ${fmtNum(counts.stale[1])} / 전체 ${fmtNum(topicN)}`)}${seg({ caption: '버전별 주제 문서', fields: verFields(p.topics), unit: '개' })}
          <p class="adm-note">다시 생성을 기다리는 주제 문서 <span class="num-strong">${fmtNum(p.dirty_topics)}</span>개. 메모가 바뀐 주제는 다음 작업 때 다시 만들어집니다.</p></div>
      </div>
    </section>
    <section class="sec" aria-labelledby="h-rp">
      ${head('h-rp', '재처리', '파이프라인 버전을 올린 뒤 옛 결과물을 새 규칙으로 다시 만듭니다. 메모 원문은 바뀌지 않고 분류와 주제 문서만 다시 만듭니다.')}
      <form class="reproc" id="rp-form">
        <fieldset class="scope-opts"><legend>범위</legend>${SCOPES.map((s, i) => {
          const [m, t] = counts[s.id];
          return html`<label class="off__opt"><input type="radio" name="scope" value="${s.id}" ${i === 0 ? 'checked' : ''}><strong>${s.label} <span class="muted small">작업 ${fmtNum(m + t)}개 (메모 ${fmtNum(m)}, 주제 ${fmtNum(t)})</span></strong><span class="off__opt-d">${s.d}</span></label>`;
        })}</fieldset>
        <p class="reproc__cost" id="rp-cost" aria-live="polite"></p>
        <button type="submit" class="btn btn--primary">${icon('refresh', 'icon--sm')}<span>재처리 대기열에 넣기</span></button>
      </form>
    </section>
    <section class="sec" aria-labelledby="h-q2">
      ${head('h-q2', '대기열', html`대기 ${n(p.queue.queued)} · 실행 중 ${n(p.queue.running)} · 가장 오래 기다린 작업 ${n(p.queue.lag_seconds)}초 · 24시간 실패 ${n(p.queue.failed_24h)} / 완료 ${n(p.queue.done_24h)}`)}
      ${sub('최근 작업', '최근 12개')}
      ${p.recent_jobs.length ? table({
        caption: '최근 작업',
        columns: [
          { label: '#', num: true, cell: (j) => html`<span class="mono">${j.id}</span>` },
          { label: '종류', cell: (j) => JOB_LABEL[j.kind] || j.kind },
          { label: '상태', cell: (j) => html`<span class="chip ${j.status === 'failed' ? 'chip--danger' : j.status === 'done' ? 'chip--state' : ''}">${JOB_STATUS[j.status] || j.status}</span>` },
          { label: '시도', num: true, cell: (j) => j.attempts },
          { label: '만든 때', cell: (j) => timeAgo(j.created_at) },
          { label: '걸린 시간', num: true, cell: (j) => (j.finished_at ? `${fmtNum(j.finished_at - j.created_at)}초` : html`<span class="muted">진행 전</span>`) },
          { label: '오류', cell: (j) => (j.error ? html`<span class="cell-err">${j.error}</span>` : '') },
        ],
        rows: p.recent_jobs,
        rowAttrs: (j) => (j.status === 'failed' ? html`class="is-denied"` : ''),
      }) : html`<p class="quiet-line">최근 작업이 없습니다.</p>`}
    </section>`);
  const form = body.querySelector('#rp-form');
  const costText = () => {
    const id = form.elements.scope.value;
    const [m, t] = counts[id];
    const est = estimate(id);
    const heur = p.llm_provider === 'heuristic';
    return { id, total: m + t, est, text: m + t === 0 ? '이 범위에는 다시 만들 것이 없습니다.'
      : `${heur ? '지금 공급자는 규칙 기반이라 LLM 비용은 들지 않고 대기열만 길어집니다. LLM 공급자를 켠 상태라면 작업마다 LLM을 호출하므로 ' : '작업마다 LLM을 호출하므로 '}${est !== null ? `지난 7일 평균으로 어림해 약 ${fmtNum(est)} 토큰이 듭니다.` : '비용이 듭니다(지난 7일 기록이 없어 양은 어림하지 못했습니다).'} 실행은 감사 로그에 남습니다.` };
  };
  const paintCost = () => render(body.querySelector('#rp-cost'), html`${icon('alert', 'icon--sm')}<span>${costText().text}</span>`);
  form.addEventListener('change', paintCost);
  paintCost();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = costText();
    if (!c.total) { toast('이 범위에는 다시 만들 것이 없습니다.'); return; }
    const ok = await confirmDialog({ title: `작업 ${fmtNum(c.total)}개를 대기열에 넣을까요`, body: c.text, confirmLabel: '재처리 실행' });
    if (!ok) return;
    await busy(e.submitter, async () => {
      const r = await api('/api/admin/pipeline/reprocess', { method: 'POST', body: { scope: c.id } });
      toast(`작업 ${fmtNum(r.enqueued)}개를 대기열에 넣었습니다.`);
      await pipeline(body, sig);
    });
  };
}

// ── 감사 로그 ──────────────────────────────────────────────────────
const PAGE = 200;
async function audit(body, sig) {
  let action = '';
  let hideLogin = true;
  let entries = [];
  let actions = [];
  let next = null;
  async function load(more) {
    const d = await api('/api/admin/audit', { query: { action, limit: PAGE, before: more ? next : undefined }, signal: sig });
    entries = more ? entries.concat(d.entries) : d.entries;
    actions = d.actions;
    next = d.next_before ?? null;
  }
  function paint(focus) {
    const rows = entries.filter((r) => !(hideLogin && !action && r.action === 'login'));
    const hidden = entries.length - rows.length;
    render(body, html`<section class="sec" aria-labelledby="h-au">
      ${head('h-au', '감사 로그', '누가 언제 무엇을 했는지 남긴 기록입니다. 지울 수 없습니다.')}
      <div class="filters">
        <label class="sr-only" for="au-act">행위로 거르기</label>
        <select class="select" id="au-act"><option value="">모든 행위</option>${actions.map((a) => html`<option value="${a}" ${a === action ? 'selected' : ''}>${ACTION_LABEL[a] || a}</option>`)}</select>
        <label class="check filters__chk"><input type="checkbox" id="au-login" ${hideLogin ? 'checked' : ''} ${action ? 'disabled' : ''}> 로그인 숨기기</label>
      </div>
      <p class="audit-legend"><span class="chip chip--hot">${icon('shield', 'icon--sm')}예외 열람</span><span class="chip chip--danger">${icon('alert', 'icon--sm')}접근 거부</span><span>은 줄 전체를 칠해 둡니다. 접근 거부 줄은 무엇을 하려다 막혔는지 세부 칸에 적습니다.</span></p>
      <div id="au-list">${rows.length ? table({
        caption: '감사 로그',
        columns: [
          { label: '시각', cell: (r) => html`<span class="mono small">${fmtDateTime(r.created_at)}</span>` },
          { label: '행위자', cell: (r) => r.actor_name || html`<span class="muted">시스템</span>` },
          { label: '행위', cell: (r) => (r.action === 'break_glass' ? html`<span class="chip chip--hot">${icon('shield', 'icon--sm')}예외 열람</span>` : r.action === 'access_denied' ? html`<span class="chip chip--danger">${icon('alert', 'icon--sm')}접근 거부</span>` : html`${ACTION_LABEL[r.action] || r.action}`) },
          { label: '대상', cell: (r) => html`${target(r)}${r.space_name ? html`<br><small class="muted">${r.space_name}</small>` : ''}` },
          { label: '세부', cell: (r) => detail(r) },
        ],
        rows,
        rowAttrs: (r) => (r.action === 'break_glass' ? html`class="is-hot"` : r.action === 'access_denied' ? html`class="is-denied"` : ''),
      }) : emptyState({ icon: 'filter', title: '기록이 없습니다', body: action ? `“${ACTION_LABEL[action] || action}” 기록이 ${next ? '최근 범위에는' : '아직'} 없습니다.` : next ? '최근 범위에는 로그인 말고 다른 기록이 없습니다. 더 보기로 이전 기록을 불러오세요.' : '아직 남은 기록이 없습니다.' })}
      <p class="adm-acts" style="margin-top: var(--s-3)">
        <span class="muted small">${fmtNum(entries.length)}건 불러옴${hidden ? ` · 로그인 ${fmtNum(hidden)}건 숨김` : ''}${next ? '' : ' · 가장 오래된 기록까지 봤습니다'}</span>
        ${next ? html`<button type="button" class="btn btn--sm" id="au-more">${icon('chevron-down', 'icon--sm')}<span>이전 기록 더 보기</span></button>` : ''}</p></div>
    </section>`);
    body.querySelector('#au-act').onchange = (e) => { action = e.target.value; reload('#au-act'); };
    body.querySelector('#au-login').onchange = (e) => { hideLogin = e.target.checked; paint('#au-login'); };
    const more = body.querySelector('#au-more');
    if (more) more.onclick = () => busy(more, async () => { const keep = window.scrollY; await load(true); paint('#au-more'); window.scrollTo(0, keep); });
    if (focus) (body.querySelector(focus) || body.querySelector('#au-act'))?.focus();
  }
  async function reload(focus) {
    render(body.querySelector('#au-list'), loading());
    try {
      await load(false);
      paint(focus);
    } catch (e) {
      if (e.name !== 'AbortError') render(body.querySelector('#au-list') || body, errorState(e));
    }
  }
  await load(false);
  paint();
}
const DENIED = { space_read: '공간 읽기', space_admin: '팀 관리자 기능', role: '역할이 필요한 기능' };
function target(r) {
  if (r.action === 'access_denied' && r.detail?.path) return html`<span class="mono small">${r.detail.path}</span>`;
  const t = r.target_type;
  if (!t) return '';
  if (t === 'memo') return html`<span class="mono">m:${r.target_id}</span>`;
  if (t === 'user') return html`사용자 <span class="mono">#${r.target_id}</span>`;
  if (t === 'policy') return html`정책 ${POLICY_LABEL[r.target_id] || r.target_id}`;
  if (t === 'token') return html`토큰 <span class="mono">#${r.target_id}</span>`;
  if (t === 'space') return html`공간 <span class="mono">#${r.target_id}</span>`;
  if (t === 'report') return html`신고 <span class="mono">#${r.target_id}</span>`;
  return html`${t} <span class="mono">${r.target_id}</span>`;
}
function detail(r) {
  const d = r.detail || {};
  if (r.action === 'access_denied') {
    const need = (d.required || []).map((x) => ROLE_LABEL[x] || TEAM_ROLE[x] || x).join('·');
    return html`<span class="detail-kv"><span>막힌 것 <b>${DENIED[d.denied] || d.denied || '알 수 없음'}</b></span>${need ? html`<span>필요한 역할 <b>${need}</b></span>` : ''}</span>`;
  }
  if (r.action === 'break_glass') return html`<span class="detail-kv"><span>메모 <b>${fmtNum(d.rows)}</b>건 열람${d.memo_id ? html` (m:${d.memo_id})` : ''}</span><span>당사자 통지함</span></span><span class="detail-reason">사유: ${d.reason}</span>`;
  const keys = Object.keys(d).filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== '');
  if (!keys.length) return '';
  const LBL = { role: '역할', personal: '개인 공간', reassigned_to: '넘겨받은 사용자', team_memos: '팀 메모', deleted_memos: '지운 메모', scope: '범위', jobs: '작업', resolution: '처리', memo_id: '메모', owner: '소유자', user_id: '사용자', name: '이름', llm_budget_tokens: '토큰 한도', origin_memo_id: '원본', acknowledged: '경고 확인', note: '메모', reason: '사유', rows: '건수' };
  const val = (k, v) => (v === null || v === undefined ? '없음' : k === 'role' ? ROLE_LABEL[v] || TEAM_ROLE[v] || v : k === 'personal' ? (v === 'delete' ? '지움' : '보관') : k === 'origin_memo_id' || k === 'memo_id' ? `m:${v}` : v === true ? '예' : v === false ? '아니요' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return html`<span class="detail-kv">${keys.map((k) => html`<span>${LBL[k] || k} <b>${val(k, d[k])}</b></span>`)}</span>`;
}

// ── 신고 ────────────────────────────────────────────────────────────
async function reports(body, sig) {
  let status = 'open';
  async function paint() {
    const d = await api('/api/admin/reports', { query: { status }, signal: sig });
    render(body, html`<section class="sec" aria-labelledby="h-rep">
      ${head('h-rep', html`신고 <span class="sec__count">${d.reports.length}</span>`, '팀 지식에 대한 신고는 본문이 함께 옵니다. 개인 공간 메모의 신고는 신고자가 내용 공유에 동의했을 때만 본문이 보입니다.')}
      <nav class="tabs" aria-label="신고 상태"><button type="button" data-st="open" ${status === 'open' ? raw('aria-selected="true"') : ''}>처리 전</button><button type="button" data-st="resolved" ${status === 'resolved' ? raw('aria-selected="true"') : ''}>처리함</button></nav>
      ${d.reports.length ? html`<div>${d.reports.map((r) => html`<article class="rep" aria-label="신고 ${r.id}">
          <p class="rep__top">${r.memo_id ? memoTag({ id: r.memo_id, tier: r.space_kind === 'team' ? 'team' : 'mine' }, { by: false }) : ''}<span>${r.space_name}</span><span>신고자 ${r.reporter}</span>${timeAgo(r.created_at)}
            ${r.status === 'resolved' ? html`<span class="chip">처리함 ${fmtDate(r.resolved_at)}</span>` : ''}</p>
          <p class="rep__reason"><b>신고 사유</b>${r.reason}</p>
          ${r.content !== null ? html`<div class="rep__body"><p class="rep__body-l">${r.space_kind === 'team' ? '신고된 메모 (팀 지식)' : '신고된 메모 (신고자가 공유에 동의함)'}</p><blockquote class="quote">${r.content}</blockquote></div>`
            : html`<p class="rep__hidden">${icon('shield', 'icon--sm')}<span>개인 공간의 메모이고 신고자가 내용 공유에 동의하지 않아 본문을 볼 수 없습니다. 처리 단계는 <a href="#/admin/access?memo=${r.memo_id}">추적</a>으로 볼 수 있습니다.</span></p>`}
          ${r.status === 'open' ? html`<div class="adm-acts">
            <button type="button" class="btn btn--sm danger-outline" data-remove="${r.id}" ${r.space_kind !== 'team' ? raw('disabled') : ''}>${icon('trash', 'icon--sm')}<span>메모 내리기</span></button>
            <button type="button" class="btn btn--sm" data-dismiss="${r.id}">${icon('check', 'icon--sm')}<span>문제없음으로 닫기</span></button>
            ${r.memo_id ? html`<a class="btn btn--quiet btn--sm" href="#/admin/access?memo=${r.memo_id}">추적</a>` : ''}
            ${r.space_kind !== 'team' ? html`<span class="muted small">개인 공간의 메모는 운영자가 내릴 수 없습니다.</span>` : ''}</div>` : ''}
        </article>`)}</div>`
        : emptyState({ icon: 'check', title: status === 'open' ? '처리할 신고가 없습니다' : '처리한 신고가 없습니다', body: status === 'open' ? '팀 지식이 틀렸다는 신고가 들어오면 여기에 보입니다.' : '' })}
    </section>`);
    body.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { status = b.dataset.st; paint().then(() => body.querySelector(`[data-st="${status}"]`)?.focus()); }));
    body.querySelectorAll('[data-remove],[data-dismiss]').forEach((b) => (b.onclick = async () => {
      const remove = !!b.dataset.remove;
      const id = Number(b.dataset.remove || b.dataset.dismiss);
      const r = d.reports.find((x) => x.id === id);
      const ok = await confirmDialog(remove
        ? { title: `m:${r.memo_id}를 내릴까요`, body: `${r.space_name}에서 이 메모를 지우고, 이 메모가 들어간 주제 문서를 다시 만듭니다. 팀 구성원의 에이전트는 다음 세션부터 받지 않습니다. 신고는 처리함으로 닫히고 감사 로그에 남습니다.`, confirmLabel: '메모 내리기', danger: true }
        : { title: '문제없음으로 닫을까요', body: '메모는 그대로 두고 신고만 처리함으로 닫습니다. 감사 로그에 남습니다.', confirmLabel: '닫기' });
      if (!ok) return;
      await busy(b, async () => {
        await api(`/api/reports/${id}/resolve`, { method: 'POST', body: { action: remove ? 'remove' : 'dismiss' } });
        toast(remove ? `m:${r.memo_id}를 내리고 신고를 닫았습니다.` : '신고를 닫았습니다.');
        await paint();
      });
    }));
  }
  await paint();
}

// ── 추적·예외 열람 ─────────────────────────────────────────────────
const STAGE_NAME = { store: '저장', analyze: '분석', topic_summary: '주제 문서 생성', promote: '자동 승격', undo: '되돌림', forget: '잊기', kind_change: '종류 변경' };
const EVENT_NAME = { remember: '저장', promote: '팀으로 공유', forget: '삭제', import: '가져옴', confirm: '후보 확인' };
const USE_NAME = { inject: '세션 시작 주입', recall: '검색에 걸림', used: '답에 쓰임' };

async function access(body, sig, c) {
  const users = (await api('/api/admin/users', { signal: sig })).users.filter((u) => !u.deactivated_at);
  const memoQ = c.query.memo || '';
  render(body, html`
    <section class="sec" aria-labelledby="h-tr">
      ${head('h-tr', '메모 추적', '메모 하나가 거친 단계(저장, 분석, 주제 생성, 사용)를 본문 없이 봅니다. 품질 문제를 볼 때 먼저 쓰는 수단입니다. 기록이 남지 않고 당사자에게 알리지 않습니다.')}
      <form class="trace-form" id="tr-form">
        <div class="field"><label class="field__label" for="tr-id">메모 id</label><input class="input input--mono" id="tr-id" inputmode="numeric" placeholder="예: 36" value="${memoQ}" autocomplete="off"><div id="tr-err"></div></div>
        <button type="submit" class="btn btn--primary">${icon('search', 'icon--sm')}<span>추적</span></button>
      </form>
      <div id="tr-out" aria-live="polite"></div>
    </section>
    <section class="sec bg-sec" aria-labelledby="h-bg">
      ${head('h-bg', '예외 열람', '운영 원칙의 예외입니다. 추적으로 풀리지 않을 때만 씁니다.')}
      <ol class="bg-steps">
        <li><span>대상 사용자와 <strong>사유(10자 이상)</strong>를 적어야 열립니다.</span></li>
        <li><span>여는 순간 <strong>감사 로그에 사유와 함께 기록</strong>됩니다. 감사자가 봅니다. 지울 수 없습니다.</span></li>
        <li><span><strong>당사자에게 바로 통지</strong>가 갑니다. 통지에는 운영자 이름, 열람한 메모 수, 사유가 그대로 들어갑니다.</span></li>
        <li><span>열린 내용은 이 화면에만 보이고, 다른 탭으로 옮기면 닫힙니다.</span></li>
      </ol>
      <button type="button" class="btn danger-outline" id="bg-open">${icon('shield', 'icon--sm')}<span>예외 열람 신청</span></button>
      <div id="bg-result"></div>
    </section>`);
  const out = body.querySelector('#tr-out');
  const form = body.querySelector('#tr-form');
  async function runTrace(id, btn) {
    const err = body.querySelector('#tr-err');
    const inp = body.querySelector('#tr-id');
    const mid = Number(String(id).replace(/^m:/i, '').trim());
    if (!Number.isInteger(mid) || mid <= 0) {
      inp.setAttribute('aria-invalid', 'true');
      fieldError(err, '메모 id는 숫자입니다. 예: 36 또는 m:36');
      inp.focus();
      return;
    }
    inp.removeAttribute('aria-invalid');
    fieldError(err, '');
    render(out, loading('단계를 불러오는 중입니다'));
    try {
      const t = await api(`/api/admin/trace/${mid}`, { signal: sig });
      render(out, traceView(t));
      if (location.hash !== `#/admin/access?memo=${mid}`) history.replaceState(null, '', `#/admin/access?memo=${mid}`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      render(out, e.status === 404 ? html`<p class="quiet-line">${icon('info', 'icon--sm')}<span>m:${mid} 메모가 없습니다. 지워졌거나(퇴사 처리로 지운 개인 메모 포함) 잘못된 id입니다.</span></p>` : errorState(e, { retry: false }));
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, () => runTrace(body.querySelector('#tr-id').value));
  };
  if (memoQ) runTrace(memoQ);
  body.querySelector('#bg-open').onclick = () => breakGlassDialog(users, body.querySelector('#bg-result'));
}

function traceView(t) {
  const m = t.memo;
  const tier = m.space?.kind === 'team' ? 'team' : m.status === 'superseded' ? 'superseded' : m.kind === 'state' ? 'state' : m.trust === 'low' ? 'candidate' : 'mine';
  const steps = [];
  for (const ev of t.events) steps.push({ at: ev.created_at, name: EVENT_NAME[ev.action] || ev.action, res: ev.undone_at ? html`<span class="warn-text">${fmtDateTime(ev.undone_at)}에 되돌림</span>` : '' });
  for (const s of t.stages) {
    let res = s.result;
    if (s.stage === 'analyze') {
      const [by, kind, rel] = s.result.split(':');
      res = html`${by === 'llm' ? 'LLM' : '규칙'} 판단 · 종류 <span class="mono">${kind}</span> · 관계 <span class="mono">${rel}</span>`;
    } else if (s.stage === 'store') res = html`마스킹 <span class="mono">${(s.result.split('=')[1]) || 0}</span>건`;
    steps.push({ at: s.created_at, name: STAGE_NAME[s.stage] || s.stage, res: html`${res}${s.ms ? html` · <span class="mono">${fmtMs(s.ms)}</span>` : ''}` });
  }
  steps.sort((a, b) => a.at - b.at);
  const topicStep = t.topics.length
    ? { name: '주제 문서', res: html`${t.topics.map((x) => html`<span class="mono">t:${x.id}</span> 요약 ${fmtNum(x.summary_chars || 0)}자 · 버전 <span class="mono">${x.pipeline_version || '없음'}</span>${x.dirty ? ' · 다시 생성 대기' : ''}`).reduce((a, b) => html`${a}<br>${b}`)}` }
    : { name: '주제 문서', res: '묶인 주제 문서가 없습니다.', miss: true };
  const useStep = t.uses.length
    ? { name: '사용', res: html`${t.uses.map((u) => html`${USE_NAME[u.kind] || u.kind} <span class="mono">${u.n}</span>번 (마지막 ${fmtAgo2(u.last)})`).reduce((a, b) => html`${a}<br>${b}`)}`, at: Math.max(...t.uses.map((u) => u.last)) }
    : { name: '사용', res: '주입·검색·쓰임 기록이 없습니다.', miss: true };
  const all = [...steps, topicStep, useStep];
  return html`<div class="tr">
    <div>
      <p class="tr__nobody">${icon('shield', 'icon--sm')}<span>본문 ${fmtNum(m.body_chars)}자는 보이지 않습니다. 내용이 꼭 필요하면 아래 예외 열람을 쓰세요.</span></p>
      <dl class="facts">
        <div><dt>메모</dt><dd>${memoTag({ id: m.id, tier }, { by: false })}</dd></div>
        <div><dt>공간</dt><dd>${m.space ? `${m.space.name} (${m.space.kind === 'team' ? '팀' : '개인'})` : '알 수 없음'}</dd></div>
        <div><dt>종류 · 출처</dt><dd><span class="mono">${m.kind}</span> · <span class="mono">${m.source}</span> · 신뢰 <span class="mono">${m.trust}</span></dd></div>
        <div><dt>상태</dt><dd><span class="mono">${m.status}</span>${m.superseded_by ? html` → <span class="mono">m:${m.superseded_by}</span>` : ''}</dd></div>
        <div><dt>범위</dt><dd><span class="mono">${m.scope}</span></dd></div>
        <div><dt>파이프라인</dt><dd><span class="mono">${m.pipeline_version || '없음'}</span></dd></div>
        <div><dt>마스킹 · 사용</dt><dd>마스킹 ${fmtNum(m.masked_count)}건 · 사용 ${fmtNum(m.use_count)}번</dd></div>
        ${m.origin_memo_id ? html`<div><dt>원본</dt><dd><span class="mono">m:${m.origin_memo_id}</span></dd></div>` : ''}
        ${m.origin_session_id ? html`<div><dt>나온 세션</dt><dd><span class="mono">#${m.origin_session_id}</span></dd></div>` : ''}
        <div><dt>만든 때</dt><dd>${fmtDateTime(m.created_at)}</dd></div>
      </dl>
    </div>
    <ol class="tr__life" aria-label="m:${m.id}가 거친 단계">${all.map((s) => html`<li class="tr__step ${s.miss ? 'is-miss' : ''}">
      <span class="tr__time">${s.at ? fmtDateTime(s.at).slice(5) : ''}</span>
      <span class="tr__node" aria-hidden="true"><i class="${s.miss ? 'is-miss' : 'is-done'}"></i></span>
      <span><span class="tr__stage">${s.name}</span><span class="tr__res" style="display:block">${s.res}</span></span></li>`)}</ol>
  </div>`;
}
const fmtAgo2 = (ts) => fmtDateTime(ts).slice(5);

function breakGlassDialog(users, slot) {
  const opName = state.me.user.name;
  const others = users.filter((u) => u.id !== state.me.user.id);
  const dlg = openDialog({
    title: '예외 열람',
    wide: true,
    body: html`<p class="pm-lead">개인 공간의 메모 내용을 엽니다. 실행하면 되돌릴 수 없는 두 가지가 일어납니다.</p>
      <ul><li><strong>감사 로그</strong>에 운영자, 대상, 사유, 열람한 메모 수가 남습니다.</li><li><strong>당사자에게 통지</strong>가 바로 갑니다.</li></ul>
      <div class="field"><label class="field__label" for="bg-user">대상 사용자</label><select class="select" id="bg-user"><option value="">고르세요</option>${others.map((u) => html`<option value="${u.id}">${u.name} (${u.email}) · 메모 ${fmtNum(u.memos)}건</option>`)}</select></div>
      <div class="field"><label class="field__label" for="bg-memo">메모 id (선택)</label><input class="input input--mono" id="bg-memo" inputmode="numeric" placeholder="비우면 최근 메모 50건" autocomplete="off" style="max-width:240px">
        <p class="field__hint">한 건만 필요하면 id를 적으세요. 필요한 만큼만 여는 것이 원칙입니다.</p></div>
      <div class="field"><label class="field__label" for="bg-reason">사유</label><textarea class="textarea" id="bg-reason" rows="3" placeholder="예: 장애 INC-2211 조사. 이 사용자의 메모가 팀 주입을 깨뜨리는지 확인"></textarea>
        <p class="field__hint"><span class="bg-count is-short" id="bg-count">0 / 10자</span> · 사유는 통지와 감사 로그에 그대로 들어갑니다.</p><div id="bg-err"></div></div>
      <div class="bg-preview"><span class="bg-preview__l">당사자가 받을 통지</span><span id="bg-prev"></span></div>
      <label class="check bg-ack"><input type="checkbox" id="bg-ack"> 기록이 남고 당사자에게 통지된다는 것을 확인했습니다</label>`,
    actions: [{ label: '취소' }, {
      label: '기록하고 열람', kind: 'danger', run: async (d) => {
        const el = d.el;
        const reason = el.querySelector('#bg-reason');
        const err = el.querySelector('#bg-err');
        if (reason.value.trim().length < 10) {
          reason.setAttribute('aria-invalid', 'true');
          fieldError(err, `사유가 ${reason.value.trim().length}자입니다. 왜 열어야 하는지 10자 이상 적으세요.`);
          reason.focus();
          return false;
        }
        const memo = el.querySelector('#bg-memo').value.replace(/^m:/i, '').trim();
        try {
          const r = await api('/api/admin/breakglass', { method: 'POST', body: { user_id: Number(el.querySelector('#bg-user').value), reason: reason.value.trim(), memo_id: memo ? Number(memo) : null } });
          showOpened(slot, r, reason.value.trim());
        } catch (e) {
          reason.setAttribute('aria-invalid', String(e.status === 400));
          fieldError(err, `열지 못했습니다. ${e.message}`);
          return false;
        }
        return true;
      },
    }],
  });
  const el = dlg.el;
  const go = el.querySelector('[data-dlg-act="1"]');
  const sync = () => {
    const len = el.querySelector('#bg-reason').value.trim().length;
    const cnt = el.querySelector('#bg-count');
    cnt.textContent = `${len} / 10자`;
    cnt.classList.toggle('is-short', len < 10);
    const sel = el.querySelector('#bg-user');
    const memo = el.querySelector('#bg-memo').value.trim();
    el.querySelector('#bg-prev').textContent = `운영자 ${opName} 님이 내 공간의 메모 ${memo ? '1' : sel.value ? Math.min(50, others.find((u) => u.id === Number(sel.value))?.memos ?? 0) : 'N'}건을 열람했습니다. 사유: ${el.querySelector('#bg-reason').value.trim() || '(사유)'}`;
    go.disabled = !sel.value || !el.querySelector('#bg-ack').checked;
    if (len >= 10) { el.querySelector('#bg-reason').removeAttribute('aria-invalid'); fieldError(el.querySelector('#bg-err'), ''); }
  };
  el.addEventListener('input', sync);
  el.addEventListener('change', sync);
  sync();
}
function showOpened(slot, r, reason) {
  render(slot, html`<div class="bg-open" role="region" aria-labelledby="bg-open-t" tabindex="-1">
    <div class="bg-open__head"><h3 class="bg-open__t" id="bg-open-t">${r.user.name} 님의 공간 · 메모 ${fmtNum(r.memos.length)}건</h3>
      <button type="button" class="btn btn--sm" data-act="bg-close">${icon('x', 'icon--sm')}<span>닫기</span></button>
      <p class="bg-open__meta">감사 로그에 기록했고 ${r.notified ? '당사자에게 통지했습니다' : '통지는 보내지 못했습니다'}. 사유: ${reason}</p></div>
    ${r.memos.length ? html`<div class="rows">${r.memos.map((m) => html`<div class="row"><div class="row__lead">${memoTag(m, { by: false })}</div>
      <div class="row__main"><p class="row__body">${m.body}</p><p class="row__meta"><span class="mono">${m.kind}</span><span class="mono">${m.status}</span>${timeAgo(m.created_at)}</p></div><div></div></div>`)}</div>`
      : html`<p class="quiet-line">열람할 메모가 없었습니다. 그래도 열람 기록과 통지는 남았습니다.</p>`}
  </div>`);
  const box = slot.firstElementChild;
  box.querySelector('[data-act="bg-close"]').onclick = () => { render(slot, ''); document.getElementById('bg-open')?.focus(); };
  box.focus();
  toast(`${r.user.name} 님의 메모 ${r.memos.length}건을 열었습니다. 감사 로그에 남았고 당사자에게 통지했습니다.`);
}

