/* shell.js: 로그인, 레일(공간 전환·메뉴·알림), 위쪽 메모 입력 겸 검색, 운영 화면 불러오기. */
import {
  $, api, addRailItem, emit, fmtAgo, getRailItems, html, icon, isTeam, listen, memoTag, navigate, on, openDialog,
  personalSpace, refreshMe, registerScreen, render, setSpace, setToken, startRouter, state, teamSpaces, toast, emptyState, pageHead,
  dispatch, esc, raw,
} from './core.js';

const ROLE_LABEL = { user: '개발자', operator: '운영자', auditor: '감사자' };
const MENU_SVG = raw('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>');

// ── 기본 메뉴 ───────────────────────────────────────────────────────
addRailItem({ id: 'home', label: '홈', icon: 'home', href: '#/home', order: 10, spaces: 'any' });
addRailItem({ id: 'wiki', label: '위키', icon: 'wiki', href: '#/wiki', order: 20, spaces: 'any' });
addRailItem({ id: 'memos', label: '메모', icon: 'memo', href: '#/memos', order: 30, spaces: 'any' });
addRailItem({ id: 'agent', label: '에이전트', icon: 'agent', href: '#/agent', order: 40 });
addRailItem({ id: 'sessions', label: '세션', icon: 'session', href: '#/sessions', order: 50 });
addRailItem({ id: 'settings', label: '설정', icon: 'settings', href: '#/settings', order: 60 });
addRailItem({ id: 'admin', label: '운영', icon: 'admin', href: '#/admin', order: 90, roles: ['operator', 'auditor'] });

// ── 운영 화면: admin.js가 있으면 불러오고, 없으면 준비 중 ─────────────
let adminLoad = null;
async function adminFallback(root, ctx) {
  if (!adminLoad) {
    adminLoad = (async () => {
      const ok = await fetch('/app/admin.js', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      if (ok) await import('./admin.js');
      return ok;
    })();
  }
  const ok = await adminLoad.catch(() => false);
  if (ok && !ctx.signal.aborted) return dispatch(); // admin.js가 등록한 화면으로 다시 맞춘다
  render(root, html`${pageHead('운영')}
    ${emptyState({ icon: 'admin', title: '운영 화면은 준비 중입니다', body: '정책, 사용자, 감사 로그를 다루는 화면이 곧 이 자리에 붙습니다. 그동안은 서버 API(/api/admin/…)로 확인하세요.' })}`);
}
registerScreen('/admin', adminFallback, { nav: 'admin', title: '운영', roles: ['operator', 'auditor'], personal: true, fallback: true });
registerScreen('/admin/*', adminFallback, { nav: 'admin', title: '운영', roles: ['operator', 'auditor'], personal: true, fallback: true });

// ── 부팅 ────────────────────────────────────────────────────────────
export async function boot() {
  listen('unauthorized', (msg) => showLogin(msg ? `${msg} 다시 로그인하세요.` : '로그인이 만료됐습니다. 다시 로그인하세요.'));
  if (!state.token) return showLogin();
  try {
    await refreshMe();
  } catch (e) {
    if (e.status === 401) return; // showLogin이 이미 불렸다
    return showBootError(e);
  }
  buildShell();
}

function showBootError(e) {
  const app = $('#app');
  app.removeAttribute('aria-busy');
  render(app, html`<main class="login"><div class="login__panel">
    <img class="wordmark" src="/assets/brand/wordmark.svg" alt="conntext">
    <div class="alert alert--danger" role="alert">${icon('alert')}<div><p class="alert__title">서버에 연결하지 못했습니다</p><p>${e.message}</p></div></div>
    <button type="button" class="btn btn--primary" id="boot-retry">${icon('refresh')}<span>다시 시도</span></button></div></main>`);
  $('#boot-retry').onclick = () => location.reload();
}

// ── 로그인 ──────────────────────────────────────────────────────────
async function showLogin(message) {
  document.title = '로그인 · Conntext';
  const app = $('#app');
  app.removeAttribute('aria-busy');
  render(app, html`<main class="login" id="login">
    <div class="login__panel">
      <img class="wordmark login__mark" src="/assets/brand/wordmark.svg" alt="conntext">
      <h1 class="login__title">계정을 골라 들어갑니다</h1>
      <div class="alert alert--warn">${icon('shield')}<div><p class="alert__title">개발용 로그인입니다</p>
        <p>비밀번호 없이 계정을 골라 들어갑니다. 사내 인증이 연결되면 이 화면은 사내 로그인으로 바뀝니다. 사내 망 밖에 이 서버를 열지 마세요.</p></div></div>
      ${message ? html`<p class="login__msg" role="alert">${message}</p>` : ''}
      <div id="login-users" class="login__users">${raw('<div class="loading"><span class="spinner" aria-hidden="true"></span><span>계정 목록을 불러오는 중입니다</span></div>')}</div>
    </div></main>`);
  const box = $('#login-users');
  let users;
  try {
    users = (await api('/api/dev-users')).users;
  } catch (e) {
    render(box, html`<div class="alert alert--danger" role="alert">${icon('alert')}<div><p class="alert__title">계정 목록을 받지 못했습니다</p>
      <p>${e.message} ${e.status === 403 ? '서버에서 CONNTEXT_DEV_LOGIN=1로 개발용 로그인을 켜야 합니다.' : ''}</p></div></div>`);
    return;
  }
  render(box, html`<ul class="login__list" aria-label="로그인할 계정">${users.map((u) => html`<li>
      <button type="button" class="login__user" data-email="${u.email}">
        <span class="login__name">${u.name}</span><span class="login__email mono">${u.email}</span>
        <span class="chip">${ROLE_LABEL[u.role] || u.role}</span>${icon('arrow-right', 'login__go')}
      </button></li>`)}</ul>`);
  on(box, 'click', '[data-email]', async (e, btn) => {
    btn.setAttribute('aria-busy', 'true');
    try {
      const { token } = await api('/api/login', { method: 'POST', body: { email: btn.dataset.email } });
      setToken(token);
      localStorage.removeItem('conntext.space');
      await refreshMe();
      if (!location.hash || location.hash === '#/' ) history.replaceState(null, '', '#/home');
      buildShell();
    } catch (err) {
      btn.removeAttribute('aria-busy');
      toast(err.message, { tone: 'error' });
    }
  });
  box.querySelector('button')?.focus();
}

async function logout() {
  setToken('');
  localStorage.removeItem('conntext.space');
  state.me = null;
  history.replaceState(null, '', '#/home');
  showLogin();
}

// ── 셸 ──────────────────────────────────────────────────────────────
let shellBuilt = false;
function buildShell() {
  const app = $('#app');
  app.removeAttribute('aria-busy');
  render(app, html`<a class="skip" href="#view">본문으로 건너뛰기</a>
  <div class="shell">
    <header class="mbar">
      <button type="button" class="btn btn--quiet btn--icon" id="rail-open" aria-label="메뉴 열기" aria-controls="rail" aria-expanded="false">${MENU_SVG}</button>
      <a href="#/home" class="mbar__brand"><img class="wordmark" src="/assets/brand/wordmark.svg" alt="conntext 홈"></a>
      <span class="mbar__space" id="mbar-space"></span>
    </header>
    <nav class="rail on-ink" id="rail" aria-label="주 메뉴"></nav>
    <div class="scrim" id="scrim" hidden></div>
    <div class="main">
      <div class="topbar" id="topbar"></div>
      <div id="receipt-slot" class="receipt-slot"></div>
      <main id="view" class="view" tabindex="-1"></main>
    </div>
  </div>`);
  renderRail();
  mountCapture($('#topbar'));
  if (!shellBuilt) {
    shellBuilt = true;
    listen('space', () => {
      renderRail();
      updateCaptureContext();
    });
    listen('me', () => {
      if ($('#rail')) renderRail();
    });
    listen('rail', () => $('#rail') && renderRail());
    listen('route', ({ nav }) => {
      currentNav = nav;
      highlightRail();
      closeRail();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const inp = $('#cap-input');
        if (inp) {
          e.preventDefault();
          closeRail();
          inp.focus();
          inp.select();
        }
      }
      if (e.key === 'Escape' && document.body.classList.contains('rail-open')) closeRail(true);
    });
  }
  $('#rail-open').onclick = openRail;
  $('#scrim').onclick = () => closeRail(true);
  startRouter($('#view'));
}

let currentNav = null;
function renderRail() {
  const rail = $('#rail');
  if (!rail || !state.me) return;
  const me = state.me;
  const team = isTeam();
  const items = getRailItems().filter((it) => (!it.roles || it.roles.includes(me.user.role)) && (it.spaces === 'any' || !team));
  const notes = me.notifications || [];
  const spaces = [personalSpace(), ...teamSpaces()].filter(Boolean);
  render(rail, html`
    <div class="rail__top">
      <a href="#/home" class="rail__brand"><img class="wordmark" src="/assets/brand/wordmark-on-ink.svg" alt="conntext 홈"></a>
      <button type="button" class="btn btn--quiet btn--icon btn--sm rail__close" id="rail-close" aria-label="메뉴 닫기">${icon('x')}</button>
    </div>
    <div class="rail__group" role="group" aria-labelledby="rail-spaces-h">
      <p class="rail__label" id="rail-spaces-h">공간</p>
      <ul class="rail__spaces">${spaces.map((s) => html`<li><button type="button" class="rail__space" data-space="${s.id}" aria-pressed="${s.id === state.space.id}">
        ${icon(s.kind === 'team' ? 'team' : 'user', 'icon--sm')}<span class="rail__space-name">${s.kind === 'team' ? s.name : '내 공간'}</span>
        ${s.kind === 'team' && s.role === 'admin' ? html`<span class="rail__role">관리자</span>` : ''}</button></li>`)}</ul>
    </div>
    ${notes.length ? html`<button type="button" class="rail__notice" id="rail-notice">
        ${icon('shield', 'icon--sm')}<span><strong>읽지 않은 알림 ${notes.length}건</strong><span class="rail__notice-sub">${notes[0].body}</span></span></button>` : ''}
    <ul class="rail__nav" aria-label="${team ? '팀 공간 메뉴' : '내 공간 메뉴'}">${items.map((it) => html`<li><a class="rail__item" href="${it.href}" data-nav="${it.id}">${icon(it.icon)}<span>${it.label}</span></a></li>`)}</ul>
    ${team ? html`<p class="rail__hint">에이전트·세션·설정은 내 공간에서 엽니다.</p>` : ''}
    <div class="rail__foot">
      <div class="rail__user"><span class="rail__user-name">${me.user.name}</span><span class="rail__user-sub">${me.user.email}${me.user.role !== 'user' ? ` · ${ROLE_LABEL[me.user.role] || me.user.role}` : ''}</span></div>
      <div class="rail__links">
        <a class="btn btn--quiet btn--sm" href="/manual" target="_blank" rel="noopener">${icon('external', 'icon--sm')}<span>매뉴얼</span></a>
        <button type="button" class="btn btn--quiet btn--sm" id="logout">로그아웃</button>
      </div>
    </div>`);
  rail.querySelectorAll('[data-space]').forEach((b) => (b.onclick = () => {
    if (Number(b.dataset.space) !== state.space.id) setSpace(b.dataset.space);
    else closeRail();
  }));
  $('#logout').onclick = logout;
  $('#rail-close').onclick = () => closeRail(true);
  const nb = $('#rail-notice');
  if (nb) nb.onclick = showNotifications;
  const ms = $('#mbar-space');
  if (ms) ms.textContent = team ? state.space.name : '내 공간';
  highlightRail();
}
function highlightRail() {
  document.querySelectorAll('.rail__item').forEach((a) => {
    if (a.dataset.nav === currentNav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
function openRail() {
  document.body.classList.add('rail-open');
  $('#scrim').hidden = false;
  $('#rail-open').setAttribute('aria-expanded', 'true');
  $('#rail').querySelector('a, button')?.focus();
}
function closeRail(returnFocus = false) {
  if (!document.body.classList.contains('rail-open')) return;
  document.body.classList.remove('rail-open');
  $('#scrim').hidden = true;
  $('#rail-open').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('#rail-open').focus();
}

function showNotifications() {
  closeRail();
  const notes = state.me.notifications || [];
  openDialog({
    title: '알림',
    body: html`<p class="muted">운영자가 내 메모를 열람하면 사유와 함께 여기로 알립니다. 열람 기록은 감사 로그에도 남습니다.</p>
      <ul class="notice-list">${notes.map((n) => html`<li><p>${n.body}</p><p class="muted small">${fmtAgo(n.created_at)}</p></li>`)}</ul>`,
    actions: [
      { label: '닫기', kind: 'quiet', value: false },
      { label: '모두 읽음으로 표시', kind: 'primary', run: async () => {
        await api('/api/notifications/read', { method: 'POST', body: {} });
        state.me.notifications = [];
        renderRail();
        emit('notifications-read');
      } },
    ],
  });
}

// ── 위쪽 입력창: 메모 저장 겸 검색 ──────────────────────────────────
const SCOPE_KEY = 'conntext.scope';
let cap = null;
function mountCapture(host) {
  const projects = state.me.projects || [];
  render(host, html`<form class="capture" id="capture" autocomplete="off">
    <div class="capture__box">
      <label class="sr-only" for="cap-input">메모를 적거나 찾기. Enter는 메모 저장입니다.</label>
      ${icon('plus', 'capture__icon')}
      <textarea id="cap-input" class="capture__input" rows="1" spellcheck="false" placeholder="메모를 적으면 저장하고, 같은 말로 기존 메모도 찾습니다"
        role="combobox" aria-expanded="false" aria-controls="cap-list" aria-autocomplete="list" aria-describedby="cap-mode"></textarea>
      <span class="capture__kbd" aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      <label class="sr-only" for="cap-scope">저장 범위</label>
      <select id="cap-scope" class="select select--sm capture__scope" title="저장 범위">
        <option value="">범위: 전체</option>
        ${projects.map((p) => html`<option value="${p.key}">${p.name}</option>`)}
      </select>
      <button type="submit" class="btn btn--primary btn--sm capture__go" id="cap-go" disabled>저장</button>
    </div>
    <div class="capture__pop" id="cap-pop" hidden>
      <p class="capture__mode" id="cap-mode" aria-live="polite"></p>
      <ul class="capture__list" id="cap-list" role="listbox" aria-label="저장 또는 관련 메모"></ul>
      <p class="capture__help"><kbd>Enter</kbd> 고른 동작 실행 · 방향키로 고르기 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 줄바꿈 · <kbd>Esc</kbd> 닫기</p>
    </div>
  </form>`);
  const form = $('#capture');
  const input = $('#cap-input');
  const pop = $('#cap-pop');
  const list = $('#cap-list');
  const scope = $('#cap-scope');
  const go = $('#cap-go');
  if (matchMedia('(max-width: 899px)').matches) input.placeholder = '메모 적기 · 찾기';
  const saved = localStorage.getItem(SCOPE_KEY);
  if (saved && projects.some((p) => p.key === saved)) scope.value = saved;
  cap = { input, scope, results: [], topics: [], sel: 0, q: '', loading: false, seq: 0, timer: 0 };

  const options = () => [{ type: 'save' }, ...cap.results.map((r) => ({ type: 'memo', r })), ...cap.topics.map((t) => ({ type: 'topic', t }))];
  const scopeName = () => (scope.value ? projects.find((p) => p.key === scope.value)?.name : '전체');

  function paint() {
    const text = input.value.trim();
    const opts = options();
    if (cap.sel >= opts.length) cap.sel = 0;
    const open = document.activeElement === input && !!text;
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    go.disabled = !text;
    const saving = cap.sel === 0;
    go.textContent = saving ? '저장' : '열기';
    form.classList.toggle('is-picking', !saving);
    $('#cap-mode').textContent = saving
      ? `Enter를 누르면 이 내용을 내 공간에 메모로 저장합니다.${isTeam() ? ' 팀 공간에는 바로 쓰지 않습니다.' : ''}`
      : 'Enter를 누르면 고른 항목을 엽니다. 저장하지 않습니다.';
    if (!open) return;
    const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
    const memoRows = cap.results.map((r, i) => html`<li role="option" id="cap-opt-${i + 1}" class="cap-opt" aria-selected="${cap.sel === i + 1}" data-i="${i + 1}">
        ${memoTag(r, { by: true })}<span class="cap-opt__body">${r.body}</span>
        <span class="cap-opt__meta">${r.topics?.[0] ? html`<span>${r.topics[0].title}</span>` : ''}${r.project_key ? html`<span class="mono">${r.project_key.split('/').pop()}</span>` : ''}</span></li>`);
    const base = cap.results.length + 1;
    const topicRows = cap.topics.map((t, i) => html`<li role="option" id="cap-opt-${base + i}" class="cap-opt" aria-selected="${cap.sel === base + i}" data-i="${base + i}">
        <span class="chip">${icon('wiki', 'icon--sm')}주제 문서</span><span class="cap-opt__body">${t.title}</span><span class="cap-opt__meta"><span>${t.space_kind === 'team' ? t.space : '내 공간'}</span></span></li>`);
    render(list, html`
      <li role="option" id="cap-opt-0" class="cap-opt cap-opt--save" aria-selected="${saving}" data-i="0">
        <span class="cap-save__key"><kbd>Enter</kbd></span>
        <span class="cap-save__text"><strong>메모로 저장</strong> <span class="cap-save__quote">“${preview}”</span></span>
        <span class="cap-opt__meta"><span>내 공간</span><span>범위: ${scopeName()}</span></span>
      </li>
      <li role="presentation" class="cap-group">${cap.loading ? '관련 메모를 찾는 중입니다' : cap.results.length || cap.topics.length ? `이미 있는 관련 메모 ${cap.results.length}건${cap.topics.length ? ` · 주제 문서 ${cap.topics.length}건` : ''}` : text.length < 2 ? '두 글자 이상 입력하면 관련 메모를 찾습니다' : '관련 메모가 없습니다. 새로 적는 내용입니다.'}</li>
      ${memoRows}${topicRows}`);
    input.setAttribute('aria-activedescendant', `cap-opt-${cap.sel}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  cap.paint = paint;

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
  async function search() {
    const q = input.value.trim();
    const seq = ++cap.seq;
    if (q.length < 2) {
      cap.results = [];
      cap.topics = [];
      cap.loading = false;
      paint();
      return;
    }
    cap.loading = true;
    paint();
    try {
      const res = await api('/api/search', { query: { q, project: scope.value } });
      if (seq !== cap.seq) return;
      cap.results = res.results || [];
      cap.topics = res.topics || [];
    } catch (e) {
      if (seq !== cap.seq) return;
      cap.results = [];
      cap.topics = [];
    }
    cap.loading = false;
    paint();
  }
  input.addEventListener('input', () => {
    grow();
    cap.sel = 0;
    clearTimeout(cap.timer);
    cap.timer = setTimeout(search, 260);
    paint();
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', () => setTimeout(() => {
    if (!form.contains(document.activeElement)) {
      pop.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  }, 120));
  scope.addEventListener('change', () => {
    localStorage.setItem(SCOPE_KEY, scope.value);
    if (input.value.trim().length >= 2) search();
    else paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중의 Enter는 무시한다
    const n = options().length;
    if (e.key === 'ArrowDown' && !pop.hidden) {
      e.preventDefault();
      cap.sel = (cap.sel + 1) % n;
      paint();
    } else if (e.key === 'ArrowUp' && !pop.hidden) {
      e.preventDefault();
      cap.sel = (cap.sel - 1 + n) % n;
      paint();
    } else if (e.key === 'Escape') {
      if (!pop.hidden) {
        e.preventDefault();
        pop.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      } else if (input.value) {
        input.value = '';
        grow();
      } else input.blur();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      act();
    }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // 누를 때 입력창 포커스를 잃지 않게
  on(list, 'click', '[data-i]', (e, li) => {
    cap.sel = Number(li.dataset.i);
    act();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    act();
  });

  async function act() {
    const text = input.value.trim();
    if (!text) return;
    const opt = options()[cap.sel];
    if (opt.type === 'memo') return openHit(`#/memos/${opt.r.id}`);
    if (opt.type === 'topic') return openHit(`#/wiki/${opt.t.id}`);
    if (text.length < 2) {
      toast('두 글자 이상 적어야 저장합니다.', { tone: 'error' });
      return;
    }
    go.setAttribute('aria-busy', 'true');
    go.disabled = true;
    input.readOnly = true;
    try {
      const res = await api('/api/memos', { method: 'POST', body: { text, project_key: scope.value || null, scope: scope.value ? 'project' : 'global' } });
      input.value = '';
      grow();
      cap.results = [];
      cap.topics = [];
      cap.sel = 0;
      showReceipt(res);
      emit('memo-saved', res);
      input.focus();
    } catch (e) {
      if (e.status !== 401) toast(`저장하지 못했습니다. ${e.message}`, { tone: 'error' });
    } finally {
      go.removeAttribute('aria-busy');
      input.readOnly = false;
      paint();
    }
  }
  function openHit(href) {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.blur();
    navigate(href);
  }
  paint();
}
function updateCaptureContext() {
  cap?.paint?.();
}

// ── 저장 결과 ───────────────────────────────────────────────────────
/** 저장 결과(서버의 describe() 문구)를 위쪽에 그대로 보여 주고 되돌리기를 둔다. 다른 화면에서도 쓴다. */
export function showReceipt(res, { title, undoneText } = {}) {
  const slot = $('#receipt-slot');
  if (!slot) return;
  const lines = String(res.message || '').split('\n');
  const tagify = (line) => raw(esc(line).replace(/m:(\d+)/g, (_, id) => `<a class="tag tag--mine" href="#/memos/${id}">m:${id}</a>`));
  render(slot, html`<div class="receipt" role="status">
    ${icon('check', 'receipt__icon')}
    <div class="receipt__text">
      ${title ? html`<p class="receipt__title">${title}</p>` : ''}
      ${lines.map((l, i) => html`<p class="${i === 0 ? 'receipt__main' : 'receipt__sub'}">${tagify(l)}</p>`)}
    </div>
    <div class="receipt__acts">
      ${res.event_id ? html`<button type="button" class="btn btn--sm" id="receipt-undo">${icon('undo', 'icon--sm')}<span>되돌리기</span></button>` : ''}
      <button type="button" class="btn btn--quiet btn--sm btn--icon" id="receipt-close" aria-label="저장 결과 닫기">${icon('x', 'icon--sm')}</button>
    </div>
  </div>`);
  $('#receipt-close').onclick = () => slot.replaceChildren();
  const ub = $('#receipt-undo');
  if (ub) {
    ub.onclick = async () => {
      ub.setAttribute('aria-busy', 'true');
      try {
        const r = await api(`/api/events/${res.event_id}/undo`, { method: 'POST', body: {} });
        render(slot, html`<div class="receipt receipt--undone" role="status">${icon('undo', 'receipt__icon')}
          <div class="receipt__text"><p class="receipt__main">${undoneText || `${r.message} m:${res.memo_id} 저장을 취소했고, 대체했던 메모가 있으면 다시 유효로 돌렸습니다.`}</p></div>
          <div class="receipt__acts"><button type="button" class="btn btn--quiet btn--sm btn--icon" id="receipt-close" aria-label="닫기">${icon('x', 'icon--sm')}</button></div></div>`);
        $('#receipt-close').onclick = () => slot.replaceChildren();
        emit('memo-saved', { undone: true });
      } catch (e) {
        ub.removeAttribute('aria-busy');
        toast(e.message, { tone: 'error' });
      }
    };
  }
}
