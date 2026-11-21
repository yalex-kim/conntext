/* =========================================================================
   core.js: Conntext 웹 앱의 공용 층 (API, 해시 라우터, 화면 등록, 렌더 도우미)

   새 화면 붙이기 (운영자 화면 예시)
   -------------------------------------------------------------------------
   // web/app/admin.js
   import { registerScreen, api, html, render, pageHead, table, errorState } from './core.js';

   registerScreen('/admin', async (root, ctx) => {
     render(root, loading());
     const data = await api('/api/admin/overview', { signal: ctx.signal });
     render(root, html`${pageHead('운영')} ...`);
   }, { nav: 'admin', title: '운영', roles: ['operator', 'auditor'] });

   registerScreen('/admin/users/:id', render, { nav: 'admin', roles: ['operator'] });

   - 경로는 해시 뒤의 경로다(`/app#/admin/users/3` → `/admin/users/3`). `:이름`은 ctx.params.이름,
     `?a=1`은 ctx.query.a. 끝에 `/*`를 붙이면 그 아래 전부와 맞는다(ctx.params.rest).
   - 렌더 함수는 (root, ctx)를 받는다. root는 이 화면 전용 빈 요소다. 오류를 던지면 라우터가
     errorState로 바꿔 그린다(401이면 로그인 화면으로 간다).
   - 렌더 함수가 { update(ctx), destroy() }를 돌려주고 opts.group을 주면, 같은 group 안에서
     경로만 바뀔 때(목록 → 상세) 화면을 새로 그리지 않고 update(ctx)를 부른다.
   - opts: nav(레일에서 강조할 항목 id), title(문서 제목), roles(이 역할만 열 수 있음),
           personal(true면 팀 공간에서 열었을 때 내 공간으로 바꿔 연다), group.
   - ctx: { path, params, query, me, space, signal(화면을 떠나면 abort), go(hash) }

   레일 메뉴 항목 추가
   -------------------------------------------------------------------------
   addRailItem({ id: 'admin', label: '운영', icon: 'admin', href: '#/admin', order: 90,
                 roles: ['operator', 'auditor'], spaces: 'personal' });  // spaces: 'personal' | 'any'
   ("운영" 항목은 shell.js가 이미 넣어 두었다. #/admin은 admin.js가 있으면 불러온다.)

   렌더 도우미
   -------------------------------------------------------------------------
   html`<p>${사용자 문자열}</p>`  보간 값은 전부 이스케이프된다. 배열은 이어 붙인다.
                                   이미 만든 html 조각과 raw()로 감싼 문자열만 그대로 들어간다.
   render(el, html`…`)            el.innerHTML을 안전하게 바꾼다.
   on(root, 'click', '[data-act=x]', (e, el) => …)   위임 이벤트.
   api(path, {method, body, query, signal})  → JSON. 실패하면 ApiError(status, message).
   memoTag(memo, {href|button, lg})  등급 라벨 태그. tierOf(memo)로 등급 계산.
   memoName(memo)  화면 문구에서 메모를 가리키는 이름(‘제목’). 문구에 m:번호를 쓰지 않는다.
   fmtAgo / fmtDate / fmtDateTime / fmtNum / fmtTokens / timeAgo(ts)(<time> 요소)
   toast(text, {action: {label, run}, tone: 'error'})
   confirmDialog({title, body, confirmLabel, danger, typeToConfirm}) → Promise<boolean>
   openDialog({title, body, actions, wide, onMount}) → {el, close(value), done}
   table({columns, rows, rowAttrs, caption})  emptyState({icon, title, body, action})
   errorState(err)  loading(text)  pageHead(title, {sub, actions})  icon(name)
   ========================================================================= */

// ── 안전한 HTML 조각 ────────────────────────────────────────────────
class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}
/** 이미 안전한 문자열임을 표시한다. 서버가 준 문자열에는 절대 쓰지 않는다. */
export function raw(s) {
  return new SafeHTML(String(s ?? ''));
}
function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new SafeHTML(out);
}
export function render(el, tpl) {
  el.innerHTML = part(tpl);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function on(root, type, selector, fn) {
  const h = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

// ── 이벤트 ──────────────────────────────────────────────────────────
const bus = new EventTarget();
export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}
export function listen(name, fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
}

// ── 상태 ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'conntext.token';
const SPACE_KEY = 'conntext.space';
export const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  me: null, // GET /api/me 응답
  space: null, // 지금 보고 있는 공간 { id, kind, name, role }
};
export function setToken(tok) {
  state.token = tok || '';
  if (tok) localStorage.setItem(TOKEN_KEY, tok);
  else localStorage.removeItem(TOKEN_KEY);
}
export const personalSpace = () => state.me?.spaces.find((s) => s.kind === 'personal');
export const teamSpaces = () => (state.me?.spaces || []).filter((s) => s.kind === 'team');
export const isTeam = () => state.space?.kind === 'team';
/** 팀 공간이면 { space_id } 를, 내 공간이면 빈 객체를 돌려준다. api()의 query에 펼쳐 쓴다. */
export const spaceQuery = () => (isTeam() ? { space_id: state.space.id } : {});

export async function refreshMe() {
  state.me = await api('/api/me');
  const want = Number(localStorage.getItem(SPACE_KEY));
  state.space = state.me.spaces.find((s) => s.id === want) || personalSpace() || state.me.spaces[0];
  emit('me', state.me);
  return state.me;
}
export function setSpace(id, { navigate: go = true } = {}) {
  const sp = state.me.spaces.find((s) => s.id === Number(id));
  if (!sp) return;
  state.space = sp;
  localStorage.setItem(SPACE_KEY, String(sp.id));
  emit('space', sp);
  if (go) navigate('#/home', { force: true });
}

// ── API ────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export async function api(path, { method = 'GET', body, query, signal } = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, '서버에 연결하지 못했습니다. 서버가 켜져 있는지, 네트워크가 연결돼 있는지 확인한 뒤 다시 시도하세요.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) {
    setToken('');
    emit('unauthorized', data?.error);
    throw new ApiError(401, data?.error || '다시 로그인해야 합니다.');
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || `요청이 실패했습니다(${res.status}).`);
  return data;
}

// ── 라우터 ──────────────────────────────────────────────────────────
const screens = [];
export function registerScreen(pattern, renderFn, opts = {}) {
  const keys = [];
  let src = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  let rest = false;
  if (src.endsWith('/*')) {
    src = src.slice(0, -2);
    rest = true;
  }
  src = src.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  const rx = new RegExp('^' + src + (rest ? '(?:/(.*))?' : '') + '$');
  if (rest) keys.push('rest');
  screens.push({ pattern, rx, keys, render: renderFn, ...opts });
  // 대체(fallback) 화면은 맨 뒤에서 맞춰 본다.
  screens.sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback));
  if (started) scheduleDispatch();
}

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/home';
  const [path, qs] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/home', query };
}
export function navigate(hash, { replace = false, force = false } = {}) {
  if (location.hash === hash) {
    if (force) dispatch();
    return;
  }
  if (replace) {
    history.replaceState(null, '', hash);
    dispatch();
  } else location.hash = hash;
}

let started = false;
let current = null; // { def, inst, ctrl, path }
let viewEl = null;
let dispatchQueued = false;
function scheduleDispatch() {
  if (dispatchQueued) return;
  dispatchQueued = true;
  queueMicrotask(() => {
    dispatchQueued = false;
    dispatch();
  });
}

/** 라우터를 시작한다. shell.js가 부른다. */
export function startRouter(el) {
  viewEl = el;
  if (!started) {
    started = true;
    addEventListener('hashchange', () => dispatch());
  }
  dispatch();
}

export async function dispatch() {
  if (!viewEl) return;
  const { path, query } = parseHash();
  let def = null;
  let params = {};
  for (const s of screens) {
    const m = s.rx.exec(path);
    if (m) {
      def = s;
      s.keys.forEach((k, i) => (params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : ''));
      break;
    }
  }
  if (def?.personal && isTeam()) {
    state.space = personalSpace();
    localStorage.setItem(SPACE_KEY, String(state.space.id));
    emit('space', state.space);
  }
  emit('route', { path, query, nav: def?.nav || null });
  const ctx = { path, params, query, me: state.me, space: state.space, go: (h) => navigate(h) };

  // 같은 group 안에서 경로만 바뀌면 화면을 다시 만들지 않는다.
  if (current && def && def.group && current.def.group === def.group && current.inst?.update) {
    current.def = def;
    ctx.signal = current.ctrl.signal;
    document.title = (def.title ? def.title + ' · ' : '') + 'Conntext';
    try {
      await current.inst.update(ctx);
    } catch (e) {
      showRenderError(current.root, e);
    }
    return;
  }

  if (current) {
    current.ctrl.abort();
    try {
      current.inst?.destroy?.();
    } catch {
      /* 화면 정리 실패는 무시한다 */
    }
  }
  const ctrl = new AbortController();
  ctx.signal = ctrl.signal;
  const root = document.createElement('div');
  root.className = 'screen';
  viewEl.replaceChildren(root);
  current = { def, inst: null, ctrl, root, path };
  document.title = (def?.title ? def.title + ' · ' : '') + 'Conntext';
  window.scrollTo(0, 0);

  if (!def) {
    render(root, html`${pageHead('찾을 수 없는 화면')}${emptyState({ icon: 'alert', title: '없는 주소입니다', body: '주소가 바뀌었거나 잘못 입력됐습니다. 홈에서 다시 찾아 들어가세요.', action: html`<a class="btn btn--primary" href="#/home">홈으로</a>` })}`);
    return;
  }
  if (def.roles && !def.roles.includes(state.me?.user.role)) {
    render(root, html`${pageHead(def.title || '권한 없음')}${forbidden()}`);
    return;
  }
  try {
    const inst = await def.render(root, ctx);
    if (current?.root === root) current.inst = inst || null;
  } catch (e) {
    if (ctrl.signal.aborted || e?.name === 'AbortError') return;
    showRenderError(root, e);
  }
}
function showRenderError(root, e) {
  if (e?.status === 401) return; // 로그인 화면으로 넘어간다
  console.warn(e);
  render(root, errorState(e));
}

// ── 레일 메뉴 ───────────────────────────────────────────────────────
const railItems = [];
export function addRailItem(item) {
  railItems.push({ order: 50, spaces: 'personal', ...item });
  railItems.sort((a, b) => a.order - b.order);
  emit('rail', railItems);
}
export const getRailItems = () => railItems.slice();

// ── 형식 ────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtAgo(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 0) return fmtDate(ts);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 2 * 86400) return '어제';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
  return fmtDate(ts);
}
/** 남은 날짜. 지났으면 0. */
export function daysLeft(ts) {
  return Math.max(0, Math.ceil((ts - Date.now() / 1000) / 86400));
}
export const fmtNum = (n) => Number(n || 0).toLocaleString('ko-KR');
export const fmtTokens = (n) => `${fmtNum(n)} 토큰`;
export function timeAgo(ts) {
  if (!ts) return '';
  return html`<time datetime="${new Date(ts * 1000).toISOString()}" title="${fmtDateTime(ts)}">${fmtAgo(ts)}</time>`;
}
/** '0.1.0' 같은 버전을 비교한다. a<b면 음수. */
export function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ── 이름표 ──────────────────────────────────────────────────────────
export const TIER_LABEL = { mine: '내 메모', team: '팀 지식', candidate: '세션 자동 추출 · 미확인', state: '진행 상태', superseded: '대체됨' };
export const KIND_LABEL = { instruction: '지시·선호', knowledge: '지식', state: '진행 상태' };
export const SOURCE_LABEL = { manual: '직접 적음', session: '세션에서 추출', import: '가져옴', promoted: '팀으로 공유', web: '웹' };
export const STATUS_LABEL = { active: '유효', superseded: '대체됨', duplicate: '중복으로 합쳐짐', deleted: '삭제됨', dismissed: '버림', expired: '만료됨' };
export const PLATFORM_LABEL = { 'claude-code': 'Claude Code', opencode: 'OpenCode', connpass: 'connpass' };
export const platformName = (p) => PLATFORM_LABEL[p] || p || '알 수 없음';

/** 메모의 등급. API가 tier를 주면 그것을, 아니면 종류·신뢰도·공간으로 계산한다. */
export function tierOf(m) {
  if (!m) return 'mine';
  if (m.status === 'superseded') return 'superseded';
  if (m.tier) return m.tier;
  if (m.space_kind === 'team') return 'team';
  if (m.kind === 'state') return 'state';
  if (m.trust === 'low') return 'candidate';
  return 'mine';
}
/**
 * 등급 라벨 태그. memo는 { id, tier?, status?, kind?, trust?, author_name|author? }.
 * opts.href: 링크로, opts.button: 버튼으로(data-memo에 id), opts.lg: 큰 크기, opts.by=false: 작성자 생략.
 */
/** 화면 문구에서 메모를 가리킬 때 쓰는 이름. id 대신 제목을 ‘ ’로 감싼다. */
export function memoName(m, n = 32) {
  let t = String((m && (m.title || m.body)) || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  t = t.replace(/[.。]+$/, '');
  if (t.length > n) t = t.slice(0, n).replace(/\s+\S*$/, '') + '…';
  return t ? `‘${t}’` : '이 메모';
}
export function memoTag(m, opts = {}) {
  const tier = opts.tier || tierOf(m);
  const cls = `tag tag--${tier}${opts.lg ? ' tag--lg' : ''}`;
  const label = `${TIER_LABEL[tier] || ''} m:${m.id}`;
  const text = `m:${m.id}`;
  const author = m.author_name || m.author;
  const by = tier === 'team' && opts.by !== false && author ? html`<span class="tag-by">${author}</span>` : '';
  let tag;
  if (opts.href) tag = html`<a class="${cls}" href="${opts.href}" aria-label="${label}" title="${label}">${text}</a>`;
  else if (opts.button) tag = html`<button type="button" class="${cls}" data-memo="${m.id}" aria-label="${label} 열기" title="${label}">${text}</button>`;
  else tag = html`<span class="${cls}" title="${label}"><span class="sr-only">${TIER_LABEL[tier]} </span>${text}</span>`;
  return html`<span class="tagwrap">${tag}${by}</span>`;
}
export function projectChip(name) {
  return name ? html`<span class="chip chip--mono">${name}</span>` : html`<span class="chip chip--scope">전체 범위</span>`;
}
export function icon(name, cls = '') {
  return html`<svg class="icon ${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"/></svg>`;
}

// ── 화면 조각 ───────────────────────────────────────────────────────
export function pageHead(title, { sub, actions } = {}) {
  return html`<header class="page-head">
    <div class="page-head__text"><h1 class="page-title">${title}</h1>${sub ? html`<p class="page-sub">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="page-head__actions">${actions}</div>` : ''}
  </header>`;
}
export function loading(text = '불러오는 중입니다') {
  return html`<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>${text}</span></div>`;
}
export function emptyState({ icon: ic = 'info', title, body, action } = {}) {
  return html`<div class="empty">${icon(ic, 'empty__icon')}<p class="empty__title">${title}</p>${body ? html`<p>${body}</p>` : ''}${action || ''}</div>`;
}
export function forbidden(msg) {
  return emptyState({ icon: 'shield', title: '이 화면을 볼 권한이 없습니다', body: msg || '필요한 역할이 없는 계정입니다. 권한이 필요하면 운영자에게 요청하세요.', action: html`<a class="btn" href="#/home">홈으로</a>` });
}
export function errorState(err, { retry = true } = {}) {
  const st = err?.status;
  if (st === 403) return forbidden(err.message);
  if (st === 404) {
    return emptyState({ icon: 'alert', title: '찾을 수 없습니다', body: `${err.message} 이미 지워졌거나 다른 공간의 항목일 수 있습니다.`, action: html`<a class="btn" href="#/home">홈으로</a>` });
  }
  return html`<div class="alert alert--danger err-block" role="alert">${icon('alert')}<div>
      <p class="alert__title">불러오지 못했습니다</p><p>${err?.message || '알 수 없는 오류가 났습니다.'}</p></div>
      ${retry ? html`<button type="button" class="btn btn--sm" data-act="retry">${icon('refresh')}<span>다시 시도</span></button>` : ''}
    </div>`;
}
/**
 * 표. columns: [{ label, num?, cls?, cell: (row) => html }], rows: [...], rowAttrs?: (row) => html(속성 문자열)
 */
export function table({ columns, rows, rowAttrs, caption, cls = '' }) {
  return html`<div class="table-wrap"><table class="table ${cls}">
    ${caption ? html`<caption class="sr-only">${caption}</caption>` : ''}
    <thead><tr>${columns.map((c) => html`<th scope="col" class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr ${rowAttrs ? rowAttrs(r) : ''}>${columns.map((c) => html`<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.cell(r)}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

/** 버튼을 바쁜 상태로 두고 작업을 끝낸다. 오류는 토스트로 알리고 다시 던지지 않는다(false 반환). */
export async function busy(btn, work) {
  if (btn) {
    if (btn.firstChild && btn.firstChild.nodeType === 3) {
      const span = document.createElement('span');
      span.textContent = btn.firstChild.textContent;
      btn.replaceChild(span, btn.firstChild);
    }
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  }
  try {
    return await work();
  } catch (e) {
    if (e?.status !== 401) toast(e.message || '작업을 끝내지 못했습니다.', { tone: 'error' });
    return false;
  } finally {
    if (btn) {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }
}

// ── 토스트 ──────────────────────────────────────────────────────────
export function toast(text, { action, tone, timeout } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast${tone === 'error' ? ' toast--error' : ''}`;
  render(t, html`${icon(tone === 'error' ? 'alert' : 'check', 'icon--sm')}<p class="toast__text">${text}</p>
    ${action ? html`<button type="button" class="btn btn--sm toast__act">${action.label}</button>` : ''}
    <button type="button" class="btn btn--quiet btn--sm btn--icon toast__close" aria-label="알림 닫기">${icon('x', 'icon--sm')}</button>`);
  const close = () => {
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 180);
  };
  t.querySelector('.toast__close').onclick = close;
  if (action) {
    t.querySelector('.toast__act').onclick = async (e) => {
      const ok = await busy(e.currentTarget, action.run);
      if (ok !== false) close();
    };
  }
  box.append(t);
  const ms = timeout ?? (action ? 10000 : tone === 'error' ? 8000 : 4000);
  let timer = setTimeout(close, ms);
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => (timer = setTimeout(close, ms)));
  return close;
}

// ── 대화상자 ────────────────────────────────────────────────────────
/**
 * openDialog({ title, body: html, actions: [{ label, kind: 'primary'|'danger'|'quiet', value, run?: async (dlg) => bool }], wide, onMount })
 * run이 false를 돌려주면 닫지 않는다. done은 닫힐 때의 value로 풀린다(Esc·취소는 null).
 */
export function openDialog({ title, body, actions = [], wide = false, onMount, label } = {}) {
  const d = document.createElement('dialog');
  d.className = `dlg${wide ? ' dlg--wide' : ''}`;
  const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
  d.setAttribute('aria-labelledby', id + '-t');
  render(d, html`<form method="dialog" class="dlg__form" novalidate>
      <header class="dlg__head"><h2 class="dlg__title" id="${id}-t">${title}</h2>
        <button type="button" class="btn btn--quiet btn--icon btn--sm" data-dlg-close aria-label="닫기">${icon('x')}</button></header>
      <div class="dlg__body">${body}</div>
      <footer class="dlg__foot">${actions.map((a, i) => html`<button type="${a.kind === 'primary' || a.kind === 'danger' ? 'submit' : 'button'}" class="btn ${a.kind ? 'btn--' + a.kind : ''}" data-dlg-act="${i}">${a.label}</button>`)}</footer>
    </form>`);
  let resolve;
  const done = new Promise((r) => (resolve = r));
  let result = null;
  const close = (v = null) => {
    result = v;
    d.close();
  };
  d.addEventListener('close', () => {
    resolve(result);
    d.remove();
  });
  d.addEventListener('cancel', () => (result = null));
  d.querySelector('[data-dlg-close]').onclick = () => close(null);
  d.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
  d.querySelectorAll('[data-dlg-act]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      const a = actions[Number(b.dataset.dlgAct)];
      if (a.run) {
        const ok = await busy(b, () => a.run(dlg));
        if (ok === false) return;
      }
      close(a.value ?? true);
    });
  });
  const dlg = { el: d, close, done, label };
  document.body.append(d);
  d.showModal();
  onMount?.(dlg);
  const first = d.querySelector('[autofocus]') || d.querySelector('.dlg__body input, .dlg__body textarea, .dlg__body select');
  if (first) first.focus();
  return dlg;
}
/** 되돌릴 수 없는 동작 확인. typeToConfirm을 주면 그 글자를 입력해야 버튼이 켜진다. */
export function confirmDialog({ title, body, confirmLabel = '확인', danger = false, typeToConfirm } = {}) {
  const typed = typeToConfirm
    ? html`<div class="field dlg__confirm"><label class="field__label" for="dlg-type">확인을 위해 <strong class="mono">${typeToConfirm}</strong>을 입력하세요</label>
        <input class="input input--mono" id="dlg-type" autocomplete="off" spellcheck="false"></div>`
    : '';
  const dlg = openDialog({
    title,
    body: html`${typeof body === 'string' ? html`<p>${body}</p>` : body}${typed}`,
    actions: [{ label: '취소', value: false }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true }],
    onMount: (dl) => {
      const btn = dl.el.querySelector('[data-dlg-act="1"]');
      if (typeToConfirm) {
        const inp = dl.el.querySelector('#dlg-type');
        btn.disabled = true;
        inp.addEventListener('input', () => (btn.disabled = inp.value.trim() !== typeToConfirm));
      } else btn.focus();
    },
  });
  return dlg.done.then((v) => v === true);
}

// 오류 화면의 "다시 시도"
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="retry"]')) dispatch();
});
