/* 홈: 내 공간(이어서 할 일, 세션 후보, 최근 저장 내역) / 팀 공간(최근 지식, 많이 참조된 주제, 구성원, 신고) */
import {
  api, busy, confirmDialog, daysLeft, emit, emptyState, fmtDate, fmtNum, html, icon, isTeam, listen, loading, memoTag, on,
  pageHead, platformName, projectChip, registerScreen, render, spaceQuery, state, timeAgo, toast, tierOf, KIND_LABEL,
} from '../core.js';
import { undoAction } from '../memo-view.js';

registerScreen('/home', async (root, ctx) => {
  render(root, loading());
  const load = async () => {
    const data = await api('/api/home', { query: spaceQuery(), signal: ctx.signal });
    if (ctx.signal.aborted) return;
    if (data.kind === 'team') paintTeam(root, data);
    else paintPersonal(root, data);
  };
  await load();
  const off = listen('memo-saved', () => load().catch(() => {}));
  const off2 = listen('notifications-read', () => load().catch(() => {}));
  on(root, 'click', '[data-reload]', () => load());
  on(root, 'click', '[data-confirm]', (e, b) => busy(b, async () => {
    const id = b.dataset.confirm;
    const r = await api(`/api/memos/${id}/confirm`, { method: 'POST', body: {} });
    toast(`m:${id}: ${r.message}`, { action: undoAction(r.event_id) });
    emit('memo-saved', r);
  }));
  on(root, 'click', '[data-dismiss]', (e, b) => busy(b, async () => {
    const id = b.dataset.dismiss;
    const r = await api(`/api/memos/${id}/dismiss`, { method: 'POST', body: {} });
    toast(`m:${id}: ${r.message}`, { action: undoAction(r.event_id) });
    emit('memo-saved', r);
  }));
  on(root, 'click', '[data-undo]', (e, b) => busy(b, async () => {
    const r = await api(`/api/events/${b.dataset.undo}/undo`, { method: 'POST', body: {} });
    toast(r.message);
    emit('memo-saved', r);
  }));
  on(root, 'click', '[data-resolve]', async (e, b) => {
    const how = b.dataset.how;
    if (how === 'remove') {
      const ok = await confirmDialog({ title: '이 팀 지식을 내릴까요', body: '팀 공간에서 메모를 지웁니다. 구성원의 에이전트에 더는 들어가지 않고, 이 화면에서는 되돌릴 수 없습니다. 작성자의 내 공간 원본은 그대로 남습니다.', confirmLabel: '메모 내리기', danger: true });
      if (!ok) return;
    }
    await busy(b, async () => {
      await api(`/api/reports/${b.dataset.resolve}/resolve`, { method: 'POST', body: { action: how } });
      toast(how === 'remove' ? '메모를 내리고 신고를 처리했습니다.' : '신고를 문제 없음으로 처리했습니다.');
      emit('memo-saved', {});
    });
  });
  return { destroy() { off(); off2(); } };
}, { nav: 'home', title: '홈' });

// ── 내 공간 ─────────────────────────────────────────────────────────
function paintPersonal(root, d) {
  const me = state.me;
  const s = d.stats;
  const byProject = new Map();
  for (const st of d.states) {
    const k = st.project || '';
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(st);
  }
  const notes = me.notifications || [];
  render(root, html`
    ${pageHead('홈', { sub: html`유효 메모 <span class="num">${fmtNum(s.memos)}</span>건 · 주제 문서 <span class="num">${fmtNum(s.topics)}</span>개 · 항상 적용 <span class="num">${fmtNum(s.instructions)}</span>건 · 최근 7일 동안 에이전트가 답에 쓴 메모 <span class="num">${fmtNum(s.used_7d)}</span>건` })}
    ${notes.length ? html`<div class="alert alert--warn home-notice" role="alert">${icon('shield')}<div><p class="alert__title">운영자 열람 알림 ${notes.length}건</p>
      ${notes.slice(0, 3).map((n) => html`<p>${n.body} <span class="muted">${timeAgo(n.created_at)}</span></p>`)}</div></div>` : ''}
    <div class="home-grid">
      <div class="home-main">
        <section class="sec" aria-labelledby="h-resume">
          <div class="sec__head"><h2 class="sec__title" id="h-resume">이어서 할 일</h2>
            <span class="sec__meta">세션이 끝날 때 남긴 진행 상태입니다. 같은 저장소에서 세션을 시작하면 에이전트가 이어받습니다.</span></div>
          ${d.states.length ? html`<div class="resume-list">${[...byProject.entries()].map(([proj, list]) => html`
            <article class="resume">
              <header class="resume__head">${projectChip(proj)}
                <span class="resume__by">${list[0].platform ? platformName(list[0].platform) : '직접 저장'} 세션이 ${timeAgo(list[0].created_at)} 남김</span>
                ${list[0].project_key ? html`<a class="btn btn--quiet btn--sm resume__see" href="#/agent?project=${encodeURIComponent(list[0].project_key)}">${icon('agent', 'icon--sm')}<span>에이전트가 받는 내용</span></a>` : ''}
              </header>
              ${list.map((st) => html`<div class="resume__item">
                <div class="resume__tagline">${memoTag(st, { href: `#/memos/${st.id}` })}${st.expires_at ? html`<span class="muted small">${fmtDate(st.expires_at)}에 만료</span>` : ''}</div>
                <p class="resume__body">${st.body}</p></div>`)}
            </article>`)}</div>`
          : emptyState({ icon: 'session', title: '이어서 할 진행 상태가 없습니다', body: '에이전트 세션에서 /conntext:handoff를 쓰거나 세션을 마치면, 남은 일과 진행 상황이 여기에 저장소별로 쌓입니다.' })}
        </section>

        <section class="sec" aria-labelledby="h-cands">
          <div class="sec__head"><h2 class="sec__title" id="h-cands">세션에서 나온 후보 <span class="sec__count num">${d.candidates.length}</span></h2>
            <span class="sec__meta">확인한 것만 정식 메모가 되어 에이전트의 기본 동작에 들어갑니다. 확인하지 않은 후보는 ${d.candidate_days}일 뒤 사라집니다.</span></div>
          ${d.candidates.length ? html`<ul class="rows">${d.candidates.map((c) => {
            const left = daysLeft(c.created_at + d.candidate_days * 86400);
            return html`<li class="row cand" data-id="${c.id}">
              <div class="row__lead">${memoTag(c, { href: `#/memos/${c.id}` })}</div>
              <div class="row__main"><p class="row__body">${c.body}</p>
                <p class="row__meta">${projectChip(c.project)}${c.session ? html`<span>${platformName(c.session.platform)} · ${c.session.summary || '세션'}</span>` : ''}
                  <span class="${left <= 5 ? 'warn-text' : ''}">${left}일 뒤 만료</span></p></div>
              <div class="row__acts">
                <button type="button" class="btn btn--sm" data-confirm="${c.id}">${icon('check', 'icon--sm')}<span>확인</span></button>
                <button type="button" class="btn btn--quiet btn--sm" data-dismiss="${c.id}">${icon('x', 'icon--sm')}<span>버림</span></button>
              </div></li>`;
          })}</ul>`
          : emptyState({ icon: 'check', title: '확인할 후보가 없습니다', body: '세션이 끝나면 대화에서 결정·원인·주의 사항을 뽑아 여기에 후보로 올립니다. 기록을 끈 상태라면 세션 화면에서 켤 수 있습니다.' })}
        </section>
      </div>

      <section class="sec home-log" aria-labelledby="h-log">
        <div class="sec__head"><h2 class="sec__title" id="h-log">최근 저장 내역</h2>
          <span class="sec__meta">무엇이 어디로 들어갔고 무엇을 대체했는지 보여 줍니다. 자동 판단은 전부 되돌릴 수 있습니다.</span></div>
        ${d.events.length ? html`<ol class="log">${d.events.map(eventRow)}</ol>`
          : emptyState({ icon: 'memo', title: '아직 저장한 메모가 없습니다', body: '위쪽 입력창에 한 줄 적고 Enter를 누르세요. 예: "스테이징 배포는 목요일 오전만 가능". 터미널에서는 /conntext:remember로 저장합니다.' })}
      </section>
    </div>`);

}

const ACTION_LABEL = { remember: '저장', forget: '삭제', confirm: '후보 확인', dismiss: '후보 버림', promote: '팀으로 공유', kind_change: '종류 변경', auto_promoted: '자주 쓰여 정식 메모로 올림' };
function eventRow(ev) {
  const m = ev.memo;
  if (!m) return '';
  const tier = m.status === 'superseded' ? 'superseded' : tierOf({ ...m, status: 'active' });
  let dest;
  if (ev.relation === 'duplicate' && ev.target) dest = html`같은 내용이 있어 ${memoTag({ id: ev.target.id, tier: 'mine' }, { href: `#/memos/${ev.target.id}` })}에 합침`;
  else if (ev.topics.length) dest = html`→ ${ev.topics.map((t, i) => html`${i ? ', ' : ''}<a href="#/wiki/${t.id}">${t.title}</a>`)}${ev.created_topic ? html` <span class="chip">새 주제</span>` : ''}`;
  else if (m.kind === 'instruction') dest = html`→ <a href="#/wiki/instructions">항상 적용 목록</a>`;
  else if (m.kind === 'state') dest = html`→ 진행 상태`;
  else dest = html`→ 미분류`;
  const replaced = ev.relation === 'update' && ev.target
    ? html`<p class="log__rel">${icon('refresh', 'icon--sm')}<span>이전 메모 ${memoTag({ id: ev.target.id, tier: 'superseded' }, { href: `#/memos/${ev.target.id}` })} “${clip(ev.target.body, 40)}” 대체</span></p>`
    : ev.relation === 'supplement' && ev.target
      ? html`<p class="log__rel">${icon('link', 'icon--sm')}<span>${memoTag({ id: ev.target.id, tier: 'mine' }, { href: `#/memos/${ev.target.id}` })}에 이어 붙임</span></p>` : '';
  const undone = !!ev.undone_at;
  return html`<li class="log__row${undone ? ' is-undone' : ''}">
    <div class="log__top">
      ${memoTag({ ...m, tier }, { href: `#/memos/${m.id}` })}
      <span class="log__verb">${ACTION_LABEL[ev.action] || ev.action}</span>
      ${m.source === 'session' ? html`<span class="chip">세션 추출</span>` : ''}
      <span class="log__time">${timeAgo(ev.created_at)}</span>
      ${undone ? html`<span class="chip">되돌림</span>` : ev.undoable ? html`<button type="button" class="btn btn--quiet btn--sm log__undo" data-undo="${ev.id}">${icon('undo', 'icon--sm')}<span>되돌리기</span></button>` : ''}
    </div>
    <p class="log__body">${clip(m.body, 120)}</p>
    <p class="log__dest">${ev.action === 'remember' || ev.action === 'promote' ? dest : ev.action === 'kind_change' ? kindDest(ev, m, undone) : ''}${ev.masked ? html` · 민감 정보 ${ev.masked}건 마스킹` : ''}</p>
    ${replaced}
  </li>`;
}
function kindDest(ev, m, undone) {
  const from = KIND_LABEL[ev.prev_kind] || ev.prev_kind || '알 수 없음';
  if (undone) return html`${from}에서 바꿨다가 되돌림`;
  // 이벤트에 바꾼 뒤 종류(ev.kind)가 있으면 그것을, 없으면(옛 서버) 메모의 현재 종류를 쓴다.
  const kind = ev.kind || m.kind;
  const to = KIND_LABEL[kind] || kind;
  const where = ev.topics.length ? html` · ${ev.topics.map((t, i) => html`${i ? ', ' : ''}<a href="#/wiki/${t.id}">${t.title}</a>`)}에 들어감`
    : kind === 'instruction' ? html` · <a href="#/wiki/instructions">항상 적용 목록</a>에 들어감` : kind === 'state' ? ' · 보존 기간이 지나면 만료' : '';
  return html`${from} → ${to}${where}`;
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── 팀 공간 ─────────────────────────────────────────────────────────
function paintTeam(root, d) {
  const sp = state.space;
  const admin = d.role === 'admin';
  render(root, html`
    ${pageHead(sp.name, { sub: html`팀 지식 <span class="num">${fmtNum(d.stats.memos)}</span>건 · 주제 문서 <span class="num">${fmtNum(d.stats.topics)}</span>개 · 팀 규칙 <span class="num">${fmtNum(d.stats.instructions)}</span>건 · 구성원 <span class="num">${d.members.length}</span>명${admin ? ' · 나는 팀 관리자' : ''}` })}
    <div class="home-grid">
      <div class="home-main">
        ${admin ? html`<section class="sec" aria-labelledby="h-reports">
          <div class="sec__head"><h2 class="sec__title" id="h-reports">신고 <span class="sec__count num">${d.reports.length}</span></h2>
            <span class="sec__meta">구성원이 틀렸거나 오래됐다고 알린 팀 지식입니다. 내리면 팀 공간에서 지워지고 에이전트에도 더는 들어가지 않습니다.</span></div>
          ${d.reports.length ? html`<ul class="rows">${d.reports.map((r) => html`<li class="row report">
              <div class="row__lead">${r.memo_id ? memoTag({ id: r.memo_id, tier: 'team' }, { href: `#/memos/${r.memo_id}` }) : ''}</div>
              <div class="row__main"><p class="row__body">${r.body || '(지워진 메모)'}</p>
                <p class="report__reason"><strong>${r.reporter}</strong>: ${r.reason}</p>
                <p class="row__meta">${timeAgo(r.created_at)} 신고</p></div>
              <div class="row__acts">
                <button type="button" class="btn btn--sm" data-resolve="${r.id}" data-how="dismiss">문제 없음</button>
                <button type="button" class="btn btn--quiet btn--sm danger-text" data-resolve="${r.id}" data-how="remove">${icon('trash', 'icon--sm')}<span>메모 내리기</span></button>
              </div></li>`)}</ul>`
          : html`<p class="quiet-line">${icon('check', 'icon--sm')}처리할 신고가 없습니다.</p>`}
        </section>` : ''}
        <section class="sec" aria-labelledby="h-recent">
          <div class="sec__head"><h2 class="sec__title" id="h-recent">최근 올라온 지식</h2>
            <span class="sec__meta">팀에 공유된 메모는 구성원 모두의 에이전트에 팀 지식으로 들어갑니다.</span></div>
          ${d.recent.length ? html`<ul class="rows">${d.recent.map((m) => html`<li class="row">
              <div class="row__lead">${memoTag(m, { href: `#/memos/${m.id}` })}</div>
              <div class="row__main"><p class="row__body">${m.body}</p>
                <p class="row__meta">${projectChip(m.scope === 'project' ? m.project : '')}${m.topics.map((t) => html`<a href="#/wiki/${t.id}">${t.title}</a>`)}<span>${timeAgo(m.created_at)}</span></p></div></li>`)}</ul>`
          : emptyState({ icon: 'team', title: '아직 팀에 올라온 지식이 없습니다', body: '내 공간의 메모나 주제 문서에서 "팀으로 공유"를 누르면 미리보기를 거쳐 여기에 올라옵니다. 팀 공간에는 직접 쓰지 않습니다.' })}
        </section>
      </div>
      <div class="home-side">
        <section class="sec" aria-labelledby="h-top">
          <div class="sec__head"><h2 class="sec__title" id="h-top">많이 참조된 주제</h2><span class="sec__meta">에이전트가 검색하거나 답에 쓴 횟수</span></div>
          ${d.top_topics.length ? html`<ol class="toplist">${d.top_topics.map((t) => html`<li><a href="#/wiki/${t.id}">${t.title}</a><span class="toplist__n"><span class="num">${fmtNum(t.refs)}</span>회</span></li>`)}</ol>`
          : html`<p class="quiet-line">아직 참조된 주제가 없습니다.</p>`}
        </section>
        <section class="sec" aria-labelledby="h-members">
          <div class="sec__head"><h2 class="sec__title" id="h-members">구성원</h2></div>
          <ul class="members">${d.members.map((u) => html`<li><span class="members__name">${u.name}</span>${u.role === 'admin' ? html`<span class="chip">관리자</span>` : ''}<span class="members__n">공유 <span class="num">${u.memos}</span>건</span></li>`)}</ul>
        </section>
      </div>
    </div>`);
}
