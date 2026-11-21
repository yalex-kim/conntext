/* 위키: 주제 문서 목록(저장소별), 문서 보기(근거 각주 → 미리보기 → 옆 패널), 지시·선호 목록, 개체 */
import {
  api, busy, confirmDialog, emptyState, errorState, fmtDate, fmtNum, html, icon, memoName, isTeam, KIND_LABEL, listen, loading, memoTag, navigate, on,
  pageHead, projectChip, registerScreen, render, spaceQuery, state, timeAgo, toast, tierOf, TIER_LABEL, emit,
} from '../core.js';
import { renderMarkdown } from '../markdown.js';
import { promoteDialog, renderMemoDetail } from '../memo-view.js';

const ENTITY_KIND = { person: '사람', system: '시스템', term: '용어' };
const opts = { nav: 'wiki', title: '위키', group: 'wiki' };
registerScreen('/wiki', wikiScreen, opts);
registerScreen('/wiki/instructions', wikiScreen, opts);
registerScreen('/wiki/entity/:eid', wikiScreen, opts);
registerScreen('/wiki/:id', wikiScreen, opts);

async function wikiScreen(root, ctx) {
  render(root, html`<div class="wiki" id="wiki">
    <nav class="wiki__nav" id="wiki-nav" aria-label="주제 문서 목록">${loading()}</nav>
    <div class="wiki__doc" id="wiki-doc"></div>
    <aside class="wiki__side" id="wiki-side" aria-label="문서 정보"></aside>
  </div>`);
  const wiki = root.querySelector('#wiki');
  const nav = root.querySelector('#wiki-nav');
  const docEl = root.querySelector('#wiki-doc');
  const side = root.querySelector('#wiki-side');
  let list = null;
  let filter = '';
  let hidden = new Set();
  let cur = { key: null, topic: null };
  let memoCtrl = null;

  async function loadList() {
    list = await api('/api/topics', { query: spaceQuery(), signal: ctx.signal });
    paintList();
  }
  function paintList() {
    const groups = new Map();
    for (const t of list.topics) {
      if (filter && !t.title.toLowerCase().includes(filter.toLowerCase())) continue;
      const k = t.project || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    const sugg = (list.suggestions || []).filter((s) => !hidden.has(suggKey(s)));
    const canAdmin = list.kind === 'personal' || list.role === 'admin';
    render(nav, html`
      <div class="wiki__search"><label class="sr-only" for="wiki-filter">주제 제목으로 거르기</label>
        ${icon('filter', 'icon--sm')}<input class="input input--sm" id="wiki-filter" placeholder="주제 제목으로 거르기" value="${filter}"></div>
      <a class="wnav__item wnav__inst" href="#/wiki/instructions" data-key="instructions">
        <span class="wnav__title">${list.kind === 'team' ? '팀 규칙' : '지시·선호'} <span class="muted">(항상 적용)</span></span><span class="wnav__n num">${list.instructions}</span></a>
      ${sugg.length && canAdmin ? html`<div class="wnav__sugg"><p class="wnav__group">정리 제안 <span class="num">${sugg.length}</span></p>
        ${sugg.map((s) => s.type === 'merge'
          ? html`<div class="sugg"><p><strong>${s.drop.title}</strong>을 <strong>${s.keep.title}</strong>에 합칠까요? <span class="muted">제목 유사도 ${s.similarity}</span></p>
              <div class="sugg__acts"><button type="button" class="btn btn--sm" data-merge="${s.keep.id}:${s.drop.id}">합치기</button><button type="button" class="btn btn--quiet btn--sm" data-hide="${suggKey(s)}">그대로 두기</button></div></div>`
          : html`<div class="sugg"><p><a href="#/wiki/${s.topic.id}">${s.topic.title}</a>에 메모가 ${s.topic.n}건 쌓였습니다. 주제를 나누면 에이전트가 찾기 쉬워집니다.</p>
              <div class="sugg__acts"><button type="button" class="btn btn--quiet btn--sm" data-hide="${suggKey(s)}">알겠습니다</button></div></div>`)}</div>` : ''}
      ${keys.length ? keys.map((k) => html`<div class="wnav__grp"><p class="wnav__group">${k ? html`<span class="mono">${k}</span>` : '전체 범위'}</p>
        <ul>${groups.get(k).map((t) => {
          const only = t.unconfirmed && t.unconfirmed === t.memos;
          return html`<li><a class="wnav__item${only ? ' is-unconfirmed' : ''}" href="#/wiki/${t.id}" data-key="${t.id}">
            <span class="wnav__title">${t.title}</span>
            <span class="wnav__meta">${only ? html`<span class="mini-cand" title="세션 자동 추출 후보만 있는 주제">미확인 후보만</span>` : html`<span class="num">${t.memos}</span>건`}</span></a></li>`;
        })}</ul></div>`)
        : list.topics.length ? html`<p class="quiet-line">"${filter}"와 맞는 주제가 없습니다.</p>`
        : emptyState({ icon: 'wiki', title: '아직 주제 문서가 없습니다', body: '메모를 저장하면 비슷한 메모끼리 주제 문서로 묶이고, 문서는 메모를 근거로 다시 쓰입니다.' })}
      ${list.entities?.length ? html`<div class="wnav__grp"><p class="wnav__group">개체</p><p class="ents">${list.entities.slice(0, 24).map((e) => html`<a class="chip ent" href="#/wiki/entity/${e.id}" title="${ENTITY_KIND[e.kind] || e.kind} · 메모 ${e.n}건">${e.name}</a>`)}</p></div>` : ''}`);
    const inp = nav.querySelector('#wiki-filter');
    inp.addEventListener('input', () => {
      filter = inp.value;
      const pos = inp.selectionStart;
      paintList();
      const n = nav.querySelector('#wiki-filter');
      n.focus();
      n.setSelectionRange(pos, pos);
    });
    markCurrent();
  }
  function suggKey(s) {
    return s.type === 'merge' ? `m${s.keep.id}-${s.drop.id}` : `s${s.topic.id}`;
  }
  function markCurrent() {
    nav.querySelectorAll('[data-key]').forEach((a) => {
      if (String(a.dataset.key) === String(cur.key)) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  on(nav, 'click', '[data-hide]', (e, b) => {
    hidden.add(b.dataset.hide);
    paintList();
  });
  on(nav, 'click', '[data-merge]', async (e, b) => {
    const [keep, drop] = b.dataset.merge.split(':').map(Number);
    const s = list.suggestions.find((x) => x.type === 'merge' && x.keep.id === keep && x.drop.id === drop);
    const ok = await confirmDialog({ title: '주제를 합칠까요', body: html`<p><strong>${s.drop.title}</strong>의 메모 ${s.drop.n}건을 <strong>${s.keep.title}</strong>로 옮기고 <strong>${s.drop.title}</strong> 문서를 없앱니다. 메모 원문은 그대로이고, 합친 문서는 다시 생성됩니다. 합친 뒤에는 이 화면에서 나눌 수 없습니다.</p>`, confirmLabel: '합치기' });
    if (!ok) return;
    await busy(b, async () => {
      await api('/api/topics/merge', { method: 'POST', body: { keep, drop } });
      toast(`${s.drop.title}을 ${s.keep.title}에 합쳤습니다.`);
      await loadList();
      navigate(`#/wiki/${keep}`);
    });
  });

  // ── 오른쪽: 문서 ────────────────────────────────────────────────
  async function show(c) {
    const p = c.path;
    const memoId = c.query.m ? Number(c.query.m) : null;
    let key = 'home';
    if (p === '/wiki/instructions') key = 'instructions';
    else if (c.params.eid) key = 'e' + c.params.eid;
    else if (c.params.id) key = Number(c.params.id);
    wiki.classList.toggle('is-detail', key !== 'home');
    if (key !== cur.key) {
      cur = { key, topic: null };
      markCurrent();
      side.replaceChildren();
      render(docEl, loading());
      try {
        if (key === 'home') paintHome();
        else if (key === 'instructions') await paintInstructions();
        else if (String(key).startsWith('e')) await paintEntity(c.params.eid);
        else await paintTopic(key);
      } catch (e) {
        if (e.name === 'AbortError') return;
        render(docEl, html`${backLink()}${errorState(e)}`);
        return;
      }
    }
    paintSide(memoId);
  }

  function backLink() {
    return html`<a class="back" href="#/wiki">${icon('chevron-right', 'icon--sm back__i')}<span>주제 목록</span></a>`;
  }

  function paintHome() {
    render(docEl, html`<div class="wiki__home">${emptyState({ icon: 'wiki', title: '주제 문서를 고르세요', body: html`주제 문서는 같은 주제의 메모를 모아 다시 쓴 문서입니다. 문장마다 붙은 ${memoTag({ id: 12, tier: isTeam() ? 'team' : 'mine' }, { by: false })} 같은 근거 표시를 누르면 원문 메모가 옆에 열립니다. 세션에 주입할 때는 제목과 한 줄만 들어가고, 본문은 에이전트가 필요할 때 꺼내 씁니다.` })}</div>`);
  }

  async function paintTopic(id) {
    const d = await api(`/api/topics/${id}`, { signal: ctx.signal });
    cur.topic = d;
    paintTopicDoc();
  }
  function paintTopicDoc(renaming = false) {
    const d = cur.topic;
    const t = d.topic;
    const byId = new Map(d.memos.map((m) => [m.id, m]));
    const active = d.memos.filter((m) => m.status === 'active');
    const onlyCand = active.length && active.every((m) => m.trust === 'low');
    const personal = t.space_kind === 'personal';
    const canRename = personal || d.role === 'admin';
    // 근거 표시: 문서 안에 처음 나온 순서대로 번호를 매긴다. 같은 메모는 같은 번호를 다시 쓴다.
    const order = new Map();
    const cite = (mid) => {
      if (!order.has(mid)) order.set(mid, order.size + 1);
      const n = order.get(mid);
      const m = byId.get(mid);
      const tier = m ? tierOf(m) : personal ? 'mine' : 'team';
      const label = `근거 ${n}: ${TIER_LABEL[tier]}, ${m ? memoName(m) : '메모'}`;
      return html`<button type="button" class="cite cite--${tier}" data-cite="${mid}" aria-haspopup="dialog" aria-expanded="false" aria-label="${label}">${n}</button>`;
    };
    render(docEl, html`<article class="doc" aria-labelledby="doc-title">
      ${backLink()}
      <header class="doc__head">
        ${renaming ? html`<form class="doc__rename" id="rename-form"><label class="sr-only" for="rename-input">새 제목</label>
            <input class="input doc__rename-input" id="rename-input" maxlength="60" value="${t.title}">
            <button type="submit" class="btn btn--primary btn--sm">저장</button><button type="button" class="btn btn--sm" id="rename-cancel">취소</button></form>`
          : html`<h1 class="doc__title" id="doc-title">${t.title}</h1>`}
        <p class="doc__meta">${projectChip(t.project)}<span>${personal ? '내 공간' : t.space_name}</span><span>유효 메모 <span class="num">${active.length}</span>건</span>
          <span>에이전트 참조 <span class="num">${fmtNum(d.refs)}</span>회</span><span>${timeAgo(t.updated_at)} 갱신</span></p>
        <div class="doc__acts">
          <button type="button" class="btn btn--sm" data-act="regen">${icon('refresh', 'icon--sm')}<span>다시 생성</span></button>
          ${canRename && !renaming ? html`<button type="button" class="btn btn--sm" data-act="rename">${icon('edit', 'icon--sm')}<span>이름 바꾸기</span></button>` : ''}
          ${personal && !onlyCand && state.me.spaces.some((s) => s.kind === 'team') ? html`<button type="button" class="btn btn--sm" data-act="promote">${icon('share', 'icon--sm')}<span>팀으로 공유</span></button>` : ''}
        </div>
      </header>
      ${onlyCand ? html`<div class="alert alert--warn">${icon('info')}<div><p class="alert__title">미확인 후보만 있는 주제입니다</p>
        <p>이 문서의 메모는 모두 세션에서 자동으로 추출됐고 아직 확인되지 않았습니다. 확인하기 전에는 에이전트의 지식 색인에 들어가지 않습니다. 근거 표시를 눌러 확인하거나 버리세요.</p></div></div>` : ''}
      <div class="prose doc__body">${t.summary ? renderMarkdown(t.summary, { cite }) : html`<p class="muted">아직 문서가 생성되지 않았습니다. "다시 생성"을 누르세요.</p>`}</div>
      <p class="legend">근거 번호를 누르면 원문 미리보기가 열립니다.
        <span class="legend__item"><span class="cite cite--${personal ? 'mine' : 'team'}" aria-hidden="true">1</span>${personal ? '내 메모' : '팀 지식'}</span>
        ${personal ? html`<span class="legend__item"><span class="cite cite--candidate" aria-hidden="true">1</span>미확인 후보</span>` : ''}
        <span class="legend__item"><span class="cite cite--superseded" aria-hidden="true">1</span>대체됨</span></p>
    </article>`);
    if (renaming) {
      const inp = docEl.querySelector('#rename-input');
      inp.focus();
      inp.select();
      docEl.querySelector('#rename-cancel').onclick = () => paintTopicDoc(false);
      docEl.querySelector('#rename-form').onsubmit = async (e) => {
        e.preventDefault();
        const title = inp.value.trim();
        if (!title) {
          inp.setAttribute('aria-invalid', 'true');
          toast('제목이 비어 있습니다.', { tone: 'error' });
          return;
        }
        await busy(e.submitter, async () => {
          await api(`/api/topics/${t.id}`, { method: 'PUT', body: { title } });
          t.title = title;
          toast('이름을 바꿨습니다.');
          paintTopicDoc(false);
          loadList().catch(() => {});
        });
      };
    }
  }

  on(docEl, 'click', '[data-act="regen"]', (e, b) => busy(b, async () => {
    const r = await api(`/api/topics/${cur.topic.topic.id}/regenerate`, { method: 'POST', body: {} });
    cur.topic.topic.summary = r.summary;
    cur.topic.topic.updated_at = Date.now() / 1000;
    paintTopicDoc();
    toast('메모를 근거로 문서를 다시 생성했습니다. 메모 원문은 바뀌지 않습니다.');
  }));
  on(docEl, 'click', '[data-act="rename"]', () => paintTopicDoc(true));
  on(docEl, 'click', '[data-act="promote"]', async () => {
    const t = cur.topic.topic;
    const r = await promoteDialog({ topicId: t.id, title: `“${t.title}” 주제를 팀으로 공유` });
    if (r) loadList().catch(() => {});
  });
  on(docEl, 'click', 'button[data-memo]', (e, b) => { closeCite(false); openMemo(Number(b.dataset.memo)); });
  on(docEl, 'click', 'button[data-cite]', (e, b) => {
    e.stopPropagation();
    if (pop && pop.anchor === b) closeCite(true);
    else openCite(b);
  });

  // ── 근거 미리보기 ────────────────────────────────────────────────
  // 각주 번호 바로 아래에 등급, 작성자, 날짜, 원문을 보여 준다. m:번호는 여기와 옆 패널에만 남긴다.
  let pop = null;
  function closeCite(refocus) {
    if (!pop) return;
    const { el, anchor } = pop;
    pop = null;
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onPopKey);
    document.removeEventListener('click', onOutside, true);
    if (refocus && anchor.isConnected) anchor.focus();
  }
  const onPopKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeCite(true); } };
  const onOutside = (e) => { if (pop && !pop.el.contains(e.target) && e.target !== pop.anchor) closeCite(false); };
  function openCite(anchor) {
    closeCite(false);
    const doc = docEl.querySelector('.doc');
    const mid = Number(anchor.dataset.cite);
    const m = cur.topic?.memos.find((x) => x.id === mid);
    const el = document.createElement('div');
    el.className = 'cite-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `근거 ${anchor.textContent} 미리보기`);
    if (!m) {
      render(el, html`<p class="muted">이 메모를 찾을 수 없습니다. 지워졌거나 문서가 오래됐을 수 있습니다. "다시 생성"을 눌러 보세요.</p>`);
    } else {
      const tier = tierOf(m);
      const uses = (m.use_count || 0);
      render(el, html`
        <p class="cite-pop__meta"><span class="cite cite--${tier}" aria-hidden="true">${anchor.textContent}</span>
          <strong>${TIER_LABEL[tier]}</strong>${m.author_name ? html`<span>${m.author_name}</span>` : ''}<span>${fmtDate(m.created_at)}</span>
          <span>${uses ? html`답에 쓰임 <span class="num">${fmtNum(uses)}</span>회` : '아직 답에 쓰이지 않음'}</span></p>
        <p class="cite-pop__body">${m.body}</p>
        ${m.status === 'superseded' ? html`<p class="cite-pop__note">새 판으로 대체된 이전 기록입니다. 지금은 유효하지 않습니다.</p>` : ''}
        <div class="cite-pop__foot"><span class="mono cite-pop__id">m:${m.id}</span>
          <button type="button" class="btn btn--sm" data-memo="${m.id}">${icon('external', 'icon--sm')}<span>원문 열기</span></button></div>`);
    }
    doc.append(el);
    // 번호 바로 아래에 둔다. 문서 폭을 넘지 않게 왼쪽을 당긴다.
    const dr = doc.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.top = `${ar.bottom - dr.top + 6}px`;
    el.style.left = `${Math.max(0, Math.min(ar.left - dr.left - 12, dr.width - w))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    pop = { el, anchor };
    document.addEventListener('keydown', onPopKey);
    setTimeout(() => document.addEventListener('click', onOutside, true));
    el.querySelector('button')?.focus({ preventScroll: true });
  }
  on(side, 'click', 'button[data-memo]', (e, b) => openMemo(Number(b.dataset.memo)));

  function openMemo(id) {
    const base = location.hash.split('?')[0];
    navigate(`${base}?m=${id}`);
  }

  // ── 옆 패널 ─────────────────────────────────────────────────────
  function paintSide(memoId) {
    memoCtrl?.abort();
    wiki.classList.toggle('has-memo', !!memoId);
    if (memoId) {
      memoCtrl = new AbortController();
      const closeIt = () => navigate(location.hash.split('?')[0]);
      renderMemoDetail(side, memoId, {
        panel: true, signal: memoCtrl.signal, onClose: closeIt,
        onChange: async (kind, res) => {
          if (typeof cur.key === 'number') {
            cur.key = null; // 문서를 다시 받는다
          }
          await loadList().catch(() => {});
          const next = kind === 'edited' && res?.memo_id ? res.memo_id : kind === 'deleted' ? null : memoId;
          const base = location.hash.split('?')[0];
          if (next) navigate(`${base}?m=${next}`, { force: true });
          else navigate(base, { force: true });
        },
      });
      side.querySelector('[data-act="close-panel"]')?.focus();
      return;
    }
    const d = cur.topic;
    if (!d) {
      side.replaceChildren();
      return;
    }
    const active = d.memos.filter((m) => m.status === 'active');
    const old = d.memos.filter((m) => m.status !== 'active');
    const row = (m) => html`<li>${memoTag(m, { button: true })}<span class="side__body">${m.body}</span></li>`;
    render(side, html`
      <section class="side__sec"><h2 class="side__h">소속 메모 <span class="num muted">${d.memos.length}</span></h2>
        ${active.length ? html`<p class="side__sub">유효 ${active.length}</p><ul class="side__list">${active.map(row)}</ul>` : ''}
        ${old.length ? html`<p class="side__sub">대체됨 ${old.length}</p><ul class="side__list is-old">${old.map(row)}</ul>` : ''}
      </section>
      <section class="side__sec"><h2 class="side__h">관련 문서</h2>
        ${d.related.length ? html`<ul class="linklist">${d.related.map((r) => html`<li><a href="#/wiki/${r.id}">${icon('wiki', 'icon--sm')}${r.title}</a></li>`)}</ul>` : html`<p class="quiet-line">연결된 다른 주제가 없습니다.</p>`}
      </section>
      <section class="side__sec"><h2 class="side__h">개체</h2>
        ${d.entities.length ? html`<p class="ents">${d.entities.map((e) => html`<a class="chip ent" href="#/wiki/entity/${e.id}" title="${ENTITY_KIND[e.kind] || e.kind}">${e.name}</a>`)}</p>` : html`<p class="quiet-line">뽑힌 개체가 없습니다.</p>`}
      </section>`);
  }

  // ── 지시·선호 ───────────────────────────────────────────────────
  async function paintInstructions() {
    const d = await api('/api/memos', { query: { ...spaceQuery(), kind: 'instruction' }, signal: ctx.signal });
    const team = isTeam();
    const glob = d.memos.filter((m) => m.scope !== 'project');
    const byProj = new Map();
    for (const m of d.memos.filter((x) => x.scope === 'project')) {
      if (!byProj.has(m.project)) byProj.set(m.project, []);
      byProj.get(m.project).push(m);
    }
    const item = (m) => html`<li class="inst">${memoTag(m, { button: true })}<p class="inst__body">${m.body}</p>
      ${m.trust === 'low' ? html`<span class="mini-cand">확인 전에는 적용되지 않음</span>` : ''}</li>`;
    render(docEl, html`<article class="doc">
      ${backLink()}
      <header class="doc__head"><h1 class="doc__title">${team ? '팀 규칙' : '지시·선호'} <span class="muted doc__title-sub">항상 적용</span></h1>
        <p class="doc__meta"><span>세션을 시작할 때마다 에이전트에 그대로 들어갑니다. 저장소 범위의 항목은 그 저장소에서만 들어갑니다.</span></p></header>
      ${d.memos.length ? html`
        ${glob.length ? html`<section class="inst-grp"><h2 class="inst-grp__h">전체 범위</h2><ul class="inst-list">${glob.map(item)}</ul></section>` : ''}
        ${[...byProj.entries()].map(([p, ms]) => html`<section class="inst-grp"><h2 class="inst-grp__h"><span class="chip chip--mono">${p}</span>에서만</h2><ul class="inst-list">${ms.map(item)}</ul></section>`)}`
      : emptyState({ icon: 'memo', title: '항상 적용할 지시가 없습니다', body: '"답변은 한국어로 해 줘"처럼 에이전트에게 늘 바라는 것을 메모로 적으면, 지시·선호로 분류되어 여기에 모이고 세션마다 들어갑니다.' })}
    </article>`);
  }

  // ── 개체 ────────────────────────────────────────────────────────
  async function paintEntity(eid) {
    const d = await api(`/api/entities/${eid}`, { signal: ctx.signal });
    render(docEl, html`<article class="doc">
      ${backLink()}
      <header class="doc__head"><h1 class="doc__title">${d.entity.name}</h1>
        <p class="doc__meta"><span class="chip">${ENTITY_KIND[d.entity.kind] || d.entity.kind}</span><span>이 개체가 나오는 메모 <span class="num">${d.memos.length}</span>건</span></p></header>
      ${d.memos.length ? html`<ul class="rows">${d.memos.map((m) => html`<li class="row"><div class="row__lead">${memoTag(m, { button: true })}</div>
        <div class="row__main"><p class="row__body">${m.body}</p><p class="row__meta">${projectChip(m.scope === 'project' ? m.project : '')}${m.topics.map((t) => html`<a href="#/wiki/${t.id}">${t.title}</a>`)}<span>${KIND_LABEL[m.kind]}</span></p></div></li>`)}</ul>`
      : emptyState({ icon: 'memo', title: '유효한 메모가 없습니다', body: '이 개체가 나오는 메모가 모두 지워졌거나 대체됐습니다.' })}
    </article>`);
  }

  await loadList();
  await show(ctx);
  const off = listen('memo-saved', () => loadList().catch(() => {}));
  return {
    update: (c) => show(c),
    destroy() {
      off();
      memoCtrl?.abort();
    },
  };
}
