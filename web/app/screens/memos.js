/* 메모: 원문 목록과 필터, 상세(고치기·삭제·공유·신고) */
import {
  api, emptyState, errorState, fmtNum, html, icon, isTeam, KIND_LABEL, listen, loading, memoTag, navigate, on,
  pageHead, projectChip, registerScreen, render, spaceQuery, state, STATUS_LABEL, timeAgo,
} from '../core.js';
import { renderMemoDetail } from '../memo-view.js';

const opts = { nav: 'memos', title: '메모', group: 'memos' };
registerScreen('/memos', memosScreen, opts);
registerScreen('/memos/:id', memosScreen, opts);

const FILTERS = ['q', 'kind', 'source', 'project', 'status', 'trust'];

async function memosScreen(root, ctx) {
  const projects = state.me.projects || [];
  render(root, html`
    ${pageHead(isTeam() ? `${state.space.name} 메모` : '메모', { sub: isTeam() ? '팀에 공유된 메모 원문입니다. 고치기와 삭제는 작성자와 팀 관리자만 할 수 있습니다.' : '적은 그대로 보존된 원문입니다. 분류와 주제 문서는 이 위에 얹은 것이고, 고치면 새 판이 이전 판을 대체합니다.' })}
    <form class="filters" id="mf" role="search" aria-label="메모 거르기">
      <div class="filters__q"><label class="sr-only" for="mf-q">검색어</label>${icon('search', 'icon--sm')}<input class="input input--sm" id="mf-q" name="q" placeholder="본문에서 찾기"></div>
      <label class="sr-only" for="mf-kind">종류</label>
      <select class="select select--sm" id="mf-kind" name="kind"><option value="">종류: 전체</option><option value="knowledge">지식</option><option value="instruction">지시·선호</option><option value="state">진행 상태</option></select>
      <label class="sr-only" for="mf-source">출처</label>
      <select class="select select--sm" id="mf-source" name="source"><option value="">출처: 전체</option><option value="manual">직접 적음·가져옴</option><option value="session">세션에서 추출</option></select>
      <label class="sr-only" for="mf-project">범위</label>
      <select class="select select--sm" id="mf-project" name="project"><option value="">범위: 전체</option><option value="__global__">전체 범위 메모만</option>${projects.map((p) => html`<option value="${p.key}">${p.name}</option>`)}</select>
      <label class="sr-only" for="mf-status">상태</label>
      <select class="select select--sm" id="mf-status" name="status"><option value="">상태: 유효</option><option value="superseded">대체됨</option><option value="dismissed">버린 후보</option><option value="all">삭제 빼고 전부</option></select>
      ${isTeam() ? '' : html`<label class="check filters__chk"><input type="checkbox" name="trust" value="low" id="mf-trust"> 미확인 후보만</label>`}
      <button type="button" class="btn btn--quiet btn--sm" id="mf-reset" hidden>거르기 해제</button>
    </form>
    <div class="split" id="msplit">
      <section class="split__list" aria-label="메모 목록"><p class="list-count" id="m-count" aria-live="polite"></p><div id="m-list">${loading()}</div></section>
      <section class="split__detail" id="m-detail" aria-label="메모 상세"></section>
    </div>`);
  const form = root.querySelector('#mf');
  const listEl = root.querySelector('#m-list');
  const detail = root.querySelector('#m-detail');
  const split = root.querySelector('#msplit');
  let lastQs = null;
  let selected = null;
  let detailCtrl = null;
  let timer = 0;

  const currentFilters = (q) => Object.fromEntries(FILTERS.filter((k) => q[k]).map((k) => [k, q[k]]));
  const qsOf = (f) => {
    const s = new URLSearchParams(f).toString();
    return s ? '?' + s : '';
  };
  function syncForm(f) {
    for (const k of FILTERS) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = f[k] === 'low';
      else if (document.activeElement !== el) el.value = f[k] || '';
    }
    root.querySelector('#mf-reset').hidden = !Object.keys(f).length;
  }
  function readForm() {
    const f = {};
    for (const k of FILTERS) {
      const el = form.elements[k];
      if (!el) continue;
      const v = el.type === 'checkbox' ? (el.checked ? 'low' : '') : el.value.trim();
      if (v) f[k] = v;
    }
    return f;
  }
  function applyForm() {
    const f = readForm();
    const base = selected ? `#/memos/${selected}` : '#/memos';
    navigate(base + qsOf(f), { replace: true });
  }
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'q') applyForm();
  });
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') {
      clearTimeout(timer);
      timer = setTimeout(applyForm, 300);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    applyForm();
  });
  root.querySelector('#mf-reset').onclick = () => navigate(selected ? `#/memos/${selected}` : '#/memos', { replace: true });

  async function loadList(f) {
    render(listEl, loading());
    let d;
    try {
      d = await api('/api/memos', { query: { ...spaceQuery(), ...f }, signal: ctx.signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      render(listEl, errorState(e));
      return;
    }
    const qs = qsOf(f);
    root.querySelector('#m-count').textContent = d.memos.length < d.total ? `${fmtNum(d.total)}건 중 최근 ${fmtNum(d.memos.length)}건` : `${fmtNum(d.total)}건`;
    if (!d.memos.length) {
      render(listEl, Object.keys(f).length
        ? emptyState({ icon: 'filter', title: '조건에 맞는 메모가 없습니다', body: '거르기 조건을 줄이거나 해제해 보세요. 검색어는 본문의 뜻이 비슷한 메모도 찾습니다.', action: html`<a class="btn" href="#/memos">거르기 해제</a>` })
        : isTeam()
          ? emptyState({ icon: 'team', title: '팀에 공유된 메모가 없습니다', body: '내 공간의 메모에서 "팀으로 공유"를 누르면 미리보기를 거쳐 이 팀에 올라옵니다.' })
          : emptyState({ icon: 'memo', title: '아직 메모가 없습니다', body: '위쪽 입력창에 한 줄 적고 Enter를 누르세요. 터미널에서는 /conntext:remember로 저장합니다. 기존 노트나 CLAUDE.md는 설정의 가져오기로 한꺼번에 넣을 수 있습니다.', action: html`<a class="btn" href="#/settings?tab=import">${icon('upload', 'icon--sm')}<span>가져오기</span></a>` }));
      return;
    }
    render(listEl, html`<ul class="mlist">${d.memos.map((m) => html`<li>
      <a class="mrow${m.status !== 'active' ? ' is-inactive' : ''}" href="#/memos/${m.id}${qs}" data-id="${m.id}">
        <span class="mrow__tag">${memoTag(m)}</span>
        <span class="mrow__body">${m.body}</span>
        <span class="mrow__meta">
          <span>${KIND_LABEL[m.kind] || m.kind}</span>
          ${m.scope === 'project' && m.project ? html`<span class="mono">${m.project}</span>` : html`<span>전체 범위</span>`}
          ${m.topics[0] ? html`<span>${m.topics[0].title}</span>` : ''}
          ${m.status !== 'active' ? html`<span>${STATUS_LABEL[m.status] || m.status}</span>` : ''}
          ${m.origin_state ? html`<span class="chip chip--warn">${m.origin_state === 'deleted' ? '원본이 삭제됨' : '원본이 바뀜'}</span>` : ''}
          ${m.use_count ? html`<span>답에 <span class="num">${m.use_count}</span>회 쓰임</span>` : ''}
          <span class="mrow__time">${timeAgo(m.created_at)}</span>
        </span></a></li>`)}</ul>`);
    markSelected();
  }
  function markSelected() {
    listEl.querySelectorAll('.mrow').forEach((a) => {
      if (Number(a.dataset.id) === selected) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  function showDetail(id) {
    detailCtrl?.abort();
    split.classList.toggle('is-detail', !!id);
    if (!id) {
      render(detail, html`<div class="split__placeholder">${emptyState({ icon: 'memo', title: '메모를 고르세요', body: '본문, 등급, 소속 주제, 대체 이력, 에이전트가 쓴 횟수를 여기에서 봅니다.' })}</div>`);
      return;
    }
    detailCtrl = new AbortController();
    const qs = qsOf(currentFilters(ctx.query));
    render(detail, html`<a class="back" href="#/memos${qs}">${icon('chevron-right', 'icon--sm back__i')}<span>메모 목록</span></a><div id="m-detail-body"></div>`);
    renderMemoDetail(detail.querySelector('#m-detail-body'), id, {
      signal: detailCtrl.signal,
      onChange: (kind, res) => {
        const f = currentFilters(ctx.query);
        lastQs = null; // 목록도 다시 받는다
        if (kind === 'edited' && res?.memo_id) navigate(`#/memos/${res.memo_id}${qsOf(f)}`, { force: true });
        else if (kind === 'deleted') navigate(`#/memos${qsOf(f)}`, { force: true });
        else navigate(location.hash, { force: true });
      },
    });
  }

  async function update(c) {
    ctx.query = c.query;
    const f = currentFilters(c.query);
    const qs = qsOf(f);
    syncForm(f);
    const id = c.params.id ? Number(c.params.id) : null;
    const listChanged = qs !== lastQs;
    if (listChanged) {
      lastQs = qs;
      await loadList(f);
    }
    if (id !== selected || listChanged || c.force) {
      const changed = id !== selected;
      selected = id;
      markSelected();
      if (changed || !id || listChanged) showDetail(id);
    }
    if (id && window.matchMedia('(max-width: 1023px)').matches) window.scrollTo(0, 0);
  }
  ctx.query = ctx.query || {};
  selected = undefined;
  await update(ctx);
  const off = listen('memo-saved', () => {
    lastQs = null;
    loadList(currentFilters(ctx.query)).then(() => (lastQs = qsOf(currentFilters(ctx.query)))).catch(() => {});
  });
  return { update, destroy() { off(); detailCtrl?.abort(); } };
}
