/* 설정: 연결(토큰·설치 명령), 가져오기, 내 데이터(내보내기·전체 삭제) */
import {
  api, busy, cmpVersion, confirmDialog, emit, emptyState, errorState, esc, fmtDateTime, html, icon, loading, navigate,
  pageHead, platformName, raw, refreshMe, registerScreen, render, state, table, timeAgo, toast,
} from '../core.js';

const opts = { nav: 'settings', title: '설정', personal: true, group: 'settings' };
registerScreen('/settings', settingsScreen, opts);

const TABS = [
  { id: 'connect', label: '연결' },
  { id: 'import', label: '가져오기' },
  { id: 'data', label: '내 데이터' },
];

async function settingsScreen(root, ctx) {
  render(root, html`${pageHead('설정')}
    <nav class="tabs" aria-label="설정 항목" id="st-tabs">${TABS.map((t) => html`<a href="#/settings?tab=${t.id}" data-tab="${t.id}">${t.label}</a>`)}</nav>
    <div id="st-body" class="st-body"></div>`);
  const body = root.querySelector('#st-body');
  let issued = null; // 방금 발급한 토큰(이 화면에서만 한 번 보여 준다)

  async function show(c) {
    const tab = TABS.some((t) => t.id === c.query.tab) ? c.query.tab : 'connect';
    root.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (tab === 'connect') await connect();
    else if (tab === 'import') importTab();
    else dataTab();
  }

  // ── 연결 ───────────────────────────────────────────────────────
  async function connect() {
    render(body, loading());
    let d;
    try {
      d = await api('/api/tokens', { signal: ctx.signal });
    } catch (e) {
      if (e.name !== 'AbortError') render(body, errorState(e));
      return;
    }
    const url = state.me.public_url || location.origin;
    const tok = issued?.token || 'ctx_…';
    const min = d.min_plugin_version;
    render(body, html`
      <section class="sec" aria-labelledby="h-issue">
        <div class="sec__head"><h2 class="sec__title" id="h-issue">에이전트 연결</h2>
          <span class="sec__meta">장비마다 토큰을 하나 발급해 플러그인에 넣습니다. 토큰은 발급할 때 한 번만 보입니다.</span></div>
        <form class="issue" id="issue-form">
          <div class="field"><label class="field__label" for="tk-label">장비 이름</label>
            <input class="input" id="tk-label" maxlength="60" placeholder="예: 회사 노트북" value="${issued ? '' : '내 노트북'}"></div>
          <button type="submit" class="btn btn--primary">${icon('key', 'icon--sm')}<span>토큰 발급</span></button>
        </form>
        ${issued ? html`<div class="alert alert--warn issued" role="alert">${icon('key')}<div>
          <p class="alert__title">“${issued.label}” 토큰을 발급했습니다. 이 화면을 떠나면 다시 볼 수 없습니다.</p>
          <div class="issued__row"><label class="sr-only" for="tk-value">발급한 토큰</label><input class="input input--mono" id="tk-value" readonly value="${issued.token}">
            <button type="button" class="btn btn--sm" data-copy="${issued.token}">${icon('copy', 'icon--sm')}<span>복사</span></button></div>
          <p>아래 설치 명령에 이 토큰이 채워져 있습니다.</p></div></div>` : ''}
        <div class="install">
          ${term('Claude Code', [
            ['claude plugin marketplace add <conntext 저장소 경로 또는 git 주소>', '# 플러그인 마켓플레이스 등록(처음 한 번)'],
            ['claude plugin install conntext@conntext', null],
            [`mkdir -p ~/.conntext/bin && curl -fsSL ${url}/client/conntext.py -o ~/.conntext/bin/conntext.py`, null],
            [`python3 ~/.conntext/bin/conntext.py setup --url ${url} --token ${tok}`, null],
            ['python3 ~/.conntext/bin/conntext.py status', null],
          ], !issued)}
          ${term('OpenCode', [
            [`mkdir -p ~/.conntext/bin && curl -fsSL ${url}/client/conntext.py -o ~/.conntext/bin/conntext.py`, null],
            [`python3 ~/.conntext/bin/conntext.py setup --url ${url} --token ${tok}`, null],
            ['python3 ~/.conntext/bin/conntext.py install opencode', '# 설치 뒤 OpenCode를 다시 시작합니다'],
          ], !issued)}
        </div>
      </section>
      <section class="sec" aria-labelledby="h-tokens">
        <div class="sec__head"><h2 class="sec__title" id="h-tokens">발급한 토큰</h2>
          <span class="sec__meta">${min ? `클라이언트 최소 버전은 ${min}입니다. 낮은 버전은 업데이트가 필요하다고 표시합니다.` : ''}</span></div>
        ${d.tokens.length ? table({
          caption: '발급한 토큰',
          columns: [
            { label: '장비 이름', cell: (t) => html`<strong>${t.label}</strong>` },
            { label: '토큰', cell: (t) => html`<span class="mono">${t.prefix}…</span>` },
            { label: '클라이언트', cell: (t) => t.client_platform ? html`${platformName(t.client_platform)} <span class="mono">${t.client_version || ''}</span>
                ${min && t.client_version && cmpVersion(t.client_version, min) < 0 ? html` <span class="chip chip--warn">${icon('alert', 'icon--sm')}업데이트 필요</span>` : ''}` : html`<span class="muted">아직 연결 안 됨</span>` },
            { label: '발급', cell: (t) => html`<span title="${fmtDateTime(t.created_at)}">${timeAgo(t.created_at)}</span>` },
            { label: '마지막 사용', cell: (t) => (t.last_used_at ? timeAgo(t.last_used_at) : html`<span class="muted">없음</span>`) },
            { label: '', cls: 'td-act', cell: (t) => html`<button type="button" class="btn btn--quiet btn--sm danger-text" data-revoke="${t.id}" data-label="${t.label}">회수</button>` },
          ],
          rows: d.tokens,
        }) : emptyState({ icon: 'key', title: '발급한 토큰이 없습니다', body: '위에서 토큰을 발급하고 설치 명령을 실행하면 이 장비의 에이전트가 Conntext에 연결됩니다.' })}
      </section>`);
    body.querySelector('#issue-form').onsubmit = async (e) => {
      e.preventDefault();
      const label = body.querySelector('#tk-label').value.trim() || '내 장비';
      await busy(e.submitter, async () => {
        const r = await api('/api/tokens', { method: 'POST', body: { label } });
        issued = { ...r, label };
        await connect();
        body.querySelector('#tk-value')?.focus();
      });
    };
    body.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    body.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
      const ok = await confirmDialog({ title: '토큰을 회수할까요', body: `“${b.dataset.label}” 토큰을 쓰는 장비의 플러그인이 바로 연결이 끊깁니다. 다시 쓰려면 새 토큰을 발급해 setup을 다시 실행해야 합니다.`, confirmLabel: '회수', danger: true });
      if (!ok) return;
      await busy(b, async () => {
        await api(`/api/tokens/${b.dataset.revoke}`, { method: 'DELETE', body: {} });
        if (issued && String(issued.id) === b.dataset.revoke) issued = null;
        toast(`“${b.dataset.label}” 토큰을 회수했습니다.`);
        await connect();
      });
    }));
  }
  function term(title, lines, placeholder) {
    const text = lines.map(([c]) => c).join('\n');
    return html`<div class="term"><div class="term__head"><span class="term__title">${title}</span>
      <button type="button" class="btn btn--quiet btn--sm" data-copy="${text}">${icon('copy', 'icon--sm')}<span>복사</span></button></div>
      <pre>${lines.map(([c, note]) => html`${note ? html`<span class="term__dim">${note}</span>\n` : ''}<span class="term__prompt">$ </span>${c}\n`)}</pre>
      ${placeholder ? html`<p class="term__foot">토큰을 발급하면 ctx_… 자리에 채워집니다.</p>` : ''}</div>`;
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했습니다.');
    } catch {
      toast('복사하지 못했습니다. 직접 선택해 복사하세요.', { tone: 'error' });
    }
  }


  // ── 가져오기 ───────────────────────────────────────────────────
  function importTab() {
    const projects = state.me.projects || [];
    render(body, html`<section class="sec" aria-labelledby="h-import">
      <div class="sec__head"><h2 class="sec__title" id="h-import">기존 노트 가져오기</h2>
        <span class="sec__meta">CLAUDE.md, 팀 위키 문서, 개인 노트를 붙여 넣으면 문단과 목록 항목 단위로 나눠 메모로 저장합니다. 각 메모는 저장할 때처럼 분류되고 주제 문서로 묶입니다.</span></div>
      <form class="import" id="import-form">
        <div class="field"><label class="field__label" for="im-text">붙여 넣을 내용</label>
          <textarea class="textarea input--mono im-text" id="im-text" rows="10" placeholder="# 빌드\n- 테스트는 make test-hw-sim으로 돌린다\n- 커밋 메시지는 conventional commits"></textarea>
          <p class="field__hint">여덟 글자보다 짧은 줄과 제목 줄은 건너뜁니다. 한 번에 200개까지 저장합니다.</p></div>
        <div class="import__row">
          <div class="field"><label class="field__label" for="im-project">범위</label>
            <select class="select" id="im-project"><option value="">전체 범위</option>${projects.map((p) => html`<option value="${p.key}">${p.name}에서만</option>`)}</select></div>
          <div class="field"><label class="field__label" for="im-name">출처 이름 (선택)</label><input class="input" id="im-name" placeholder="예: ble-gateway/CLAUDE.md"></div>
        </div>
        <button type="submit" class="btn btn--primary">${icon('upload', 'icon--sm')}<span>가져오기</span></button>
      </form>
      <div id="im-result"></div></section>`);
    body.querySelector('#import-form').onsubmit = async (e) => {
      e.preventDefault();
      const ta = body.querySelector('#im-text');
      if (!ta.value.trim()) {
        ta.setAttribute('aria-invalid', 'true');
        ta.focus();
        toast('가져올 내용이 비어 있습니다. 노트를 붙여 넣으세요.', { tone: 'error' });
        return;
      }
      ta.removeAttribute('aria-invalid');
      await busy(e.submitter, async () => {
        const r = await api('/api/import', { method: 'POST', body: { text: ta.value, project_key: body.querySelector('#im-project').value || null, name: body.querySelector('#im-name').value.trim() || null } });
        const evs = r.results.map((x) => x.event_id).filter(Boolean);
        render(body.querySelector('#im-result'), html`<div class="im-done">
          <div class="sec__head"><h3 class="sec__title">${r.count}건을 저장했습니다</h3>
            ${evs.length ? html`<button type="button" class="btn btn--sm" id="im-undo">${icon('undo', 'icon--sm')}<span>전부 되돌리기</span></button>` : ''}</div>
          ${r.count ? html`<ol class="im-list">${r.results.map((x) => html`<li><pre class="im-msg">${raw(esc(x.message).replace(/m:(\d+)/, '<a class="tag tag--mine" href="#/memos/$1">m:$1</a>'))}</pre></li>`)}</ol>`
            : html`<p class="quiet-line">메모로 나눌 만한 줄이 없었습니다. 한 줄이 여덟 글자 이상인지 확인하세요.</p>`}</div>`);
        ta.value = '';
        emit('memo-saved', {});
        const ub = body.querySelector('#im-undo');
        if (ub) ub.onclick = () => busy(ub, async () => {
          for (const ev of evs) await api(`/api/events/${ev}/undo`, { method: 'POST', body: {} }).catch(() => {});
          toast(`가져온 ${evs.length}건을 되돌렸습니다.`);
          render(body.querySelector('#im-result'), '');
          emit('memo-saved', {});
        });
      });
    };
  }

  // ── 내 데이터 ──────────────────────────────────────────────────
  function dataTab() {
    const email = state.me.user.email;
    render(body, html`
      <section class="sec" aria-labelledby="h-export">
        <div class="sec__head"><h2 class="sec__title" id="h-export">내보내기</h2>
          <span class="sec__meta">내 공간의 메모(삭제한 것 제외), 주제 문서, 세션 요약을 JSON 파일 하나로 받습니다. 내보낸 기록은 감사 로그에 남습니다.</span></div>
        <button type="button" class="btn" id="exp">${icon('download', 'icon--sm')}<span>JSON으로 내보내기</span></button>
      </section>
      <section class="sec danger-zone" aria-labelledby="h-wipe">
        <div class="sec__head"><h2 class="sec__title" id="h-wipe">내 데이터 전체 삭제</h2>
          <span class="sec__meta">내 공간의 메모, 주제 문서, 세션 기록을 모두 지웁니다. 팀에 공유한 사본은 팀 지식이라 남습니다. 되돌릴 수 없으니 먼저 내보내기를 받아 두세요.</span></div>
        <form class="wipe" id="wipe-form">
          <div class="field"><label class="field__label" for="wipe-email">확인을 위해 이메일 <span class="mono">${email}</span>을 입력하세요</label>
            <input class="input input--mono" id="wipe-email" autocomplete="off" spellcheck="false"></div>
          <button type="submit" class="btn btn--danger" id="wipe-go" disabled>${icon('trash', 'icon--sm')}<span>전체 삭제</span></button>
        </form>
      </section>`);
    body.querySelector('#exp').onclick = (e) => busy(e.currentTarget, async () => {
      const d = await api('/api/export');
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `conntext-${email.split('@')[0]}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`메모 ${d.memos.length}건, 주제 ${d.topics.length}개, 세션 ${d.sessions.length}개를 내보냈습니다.`);
    });
    const inp = body.querySelector('#wipe-email');
    const go = body.querySelector('#wipe-go');
    inp.addEventListener('input', () => (go.disabled = inp.value.trim() !== email));
    body.querySelector('#wipe-form').onsubmit = async (e) => {
      e.preventDefault();
      if (inp.value.trim() !== email) return;
      const ok = await confirmDialog({ title: '정말 모두 삭제할까요', body: '내 공간의 메모, 주제 문서, 세션 기록이 모두 지워지고 되돌릴 수 없습니다. 에이전트는 다음 세션부터 아무 맥락도 받지 않습니다.', confirmLabel: '전체 삭제', danger: true });
      if (!ok) return;
      await busy(go, async () => {
        const r = await api('/api/me/data', { method: 'DELETE', body: { confirm: inp.value.trim() } });
        toast(`메모 ${r.deleted_memos}건을 포함해 내 데이터를 지웠습니다.`);
        await refreshMe();
        emit('memo-saved', {});
        navigate('#/home');
      });
    };
  }

  await show(ctx);
  return { update: (c) => show(c) };
}
