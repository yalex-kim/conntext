/* 세션: 기록 켜기/끄기, 플랫폼별 세션 목록, 상세(진행 상태, 추출된 메모, 축약 대화록), 삭제 */
import {
  api, busy, confirmDialog, emptyState, errorState, fmtDate, fmtDateTime, fmtNum, html, icon, loading, memoTag, navigate,
  pageHead, platformName, projectChip, registerScreen, render, state, timeAgo, toast, emit, STATUS_LABEL,
} from '../core.js';

const opts = { nav: 'sessions', title: '세션', personal: true, group: 'sessions' };
registerScreen('/sessions', sessionsScreen, opts);
registerScreen('/sessions/:id', sessionsScreen, opts);

const SESSION_STATUS = { open: '진행 중', uploaded: '정리 대기', extracted: '정리됨', excluded: '수집 제외', failed: '정리 실패' };

async function sessionsScreen(root, ctx) {
  render(root, loading());
  let data;
  let selected;
  let platform = ctx.query.platform || '';

  async function loadList() {
    data = await api('/api/sessions', { signal: ctx.signal });
  }
  await loadList();

  function paint() {
    const r = data.retention;
    const plats = [...new Set(data.sessions.map((s) => s.platform))];
    const list = data.sessions.filter((s) => !platform || s.platform === platform);
    render(root, html`
      ${pageHead('세션')}
      <div class="capture-ctl">
        <label class="switch"><input type="checkbox" role="switch" id="cap-switch" ${data.paused ? '' : 'checked'}> <strong>세션 기록 ${data.paused ? '꺼짐' : '켜짐'}</strong></label>
        <p class="capture-ctl__text">${data.paused
          ? '지금은 세션 대화록을 올리지 않고, 후보와 진행 상태도 새로 만들지 않습니다. 세션 시작 때 맥락을 넣는 것은 계속됩니다.'
          : html`세션이 끝나면 대화록을 축약하고 민감 정보를 가린 뒤 서버에 올려, 진행 상태와 후보를 뽑습니다. 대화록은 <span class="num">${r.transcript_days}</span>일, 확인하지 않은 후보는 <span class="num">${r.candidate_days}</span>일, 진행 상태는 <span class="num">${r.state_days}</span>일 보존합니다.`}
          수집 대상: ${(data.policy.platforms || []).map(platformName).join(', ')}.</p>
      </div>
      ${plats.length > 1 ? html`<nav class="tabs" aria-label="플랫폼">
        <a href="#/sessions" ${!platform ? 'aria-current="page"' : ''}>전체 <span class="num muted">${data.sessions.length}</span></a>
        ${plats.map((p) => html`<a href="#/sessions?platform=${p}" ${platform === p ? 'aria-current="page"' : ''}>${platformName(p)} <span class="num muted">${data.sessions.filter((s) => s.platform === p).length}</span></a>`)}
      </nav>` : ''}
      <div class="split" id="ssplit">
        <section class="split__list" aria-label="세션 목록">
          ${list.length ? html`<ul class="mlist">${list.map((s) => html`<li><a class="mrow srow" href="#/sessions/${s.id}${platform ? `?platform=${platform}` : ''}" data-id="${s.id}">
            <span class="srow__top"><span class="chip">${SESSION_STATUS[s.status] || s.status}</span><span>${platformName(s.platform)}</span>${projectChip(s.project)}<span class="mrow__time">${timeAgo(s.ended_at || s.started_at)}</span></span>
            <span class="mrow__body">${s.summary || (s.status === 'open' ? '세션이 아직 끝나지 않았습니다.' : '요약 없음')}</span>
            <span class="mrow__meta">${s.candidates ? html`<span>후보 <span class="num">${s.candidates}</span>건</span>` : ''}${s.transcript_chars ? html`<span>대화록 <span class="num">${fmtNum(s.transcript_chars)}</span>자</span>` : ''}${s.masked_count ? html`<span>마스킹 ${s.masked_count}건</span>` : ''}</span>
          </a></li>`)}</ul>`
          : emptyState({ icon: 'session', title: '기록된 세션이 없습니다', body: '플러그인을 설치한 저장소에서 Claude Code나 OpenCode 세션을 시작하면 여기에 쌓입니다.', action: html`<a class="btn" href="#/settings">연결 설정</a>` })}
        </section>
        <section class="split__detail" id="s-detail" aria-label="세션 상세"></section>
      </div>`);
    root.querySelector('#cap-switch').addEventListener('change', async (e) => {
      const paused = !e.target.checked;
      e.target.disabled = true;
      try {
        await api('/api/me', { method: 'PUT', body: { capture_paused: paused } });
        data.paused = paused;
        state.me.user.capture_paused = paused ? 1 : 0;
        toast(paused ? '세션 기록을 껐습니다. 이미 올라온 대화록은 그대로 있습니다.' : '세션 기록을 켰습니다.');
        paint();
        showDetail(selected, true);
        root.querySelector('#cap-switch').focus();
      } catch (err) {
        e.target.checked = !e.target.checked;
        e.target.disabled = false;
        toast(err.message, { tone: 'error' });
      }
    });
  }

  async function showDetail(id, force = false) {
    const det = root.querySelector('#s-detail');
    root.querySelector('#ssplit')?.classList.toggle('is-detail', !!id);
    root.querySelectorAll('.srow').forEach((a) => (Number(a.dataset.id) === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    if (!id) {
      render(det, html`<div class="split__placeholder">${emptyState({ icon: 'session', title: '세션을 고르세요', body: '세션이 남긴 진행 상태, 뽑아낸 메모, 서버에 저장된 축약 대화록을 봅니다.' })}</div>`);
      return;
    }
    render(det, loading());
    let s;
    try {
      s = await api(`/api/sessions/${id}`, { signal: ctx.signal });
    } catch (e) {
      if (e.name !== 'AbortError') render(det, html`${back()}${errorState(e, { retry: false })}`);
      return;
    }
    const h = s.handoff || {};
    let inj = s.injection;
    // 지금 서버는 배열로 준다. 옛 서버(JSON 문자열)와도 맞도록 문자열이면 파싱한다.
    if (inj && typeof inj.memo_ids === 'string') {
      try { inj = { ...inj, memo_ids: JSON.parse(inj.memo_ids), topic_ids: JSON.parse(inj.topic_ids || '[]') }; } catch { /* 형식이 다르면 개수를 생략한다 */ }
    }
    const extracted = s.memos.filter((m) => m.kind !== 'state');
    const states = s.memos.filter((m) => m.kind === 'state');
    render(det, html`${back()}<article class="sdet">
      <header class="sdet__head"><h2 class="sdet__title">${s.summary || `${platformName(s.platform)} 세션`}</h2>
        <p class="doc__meta"><span class="chip">${SESSION_STATUS[s.status] || s.status}</span><span>${platformName(s.platform)}</span>${projectChip(s.project)}
          <span>${fmtDateTime(s.started_at)}${s.ended_at ? ` ~ ${fmtDateTime(s.ended_at).slice(11)}` : ''}</span>${s.checkpoints ? html`<span>대화 중 정리 <span class="num">${s.checkpoints}</span>회</span>` : ''}</p></header>
      ${inj ? html`<p class="sdet__inj">${icon('agent', 'icon--sm')}<span>시작할 때 <span class="num">${fmtNum(inj.tokens)}</span> 토큰을 넣었습니다${Array.isArray(inj.memo_ids) ? html` (메모 <span class="num">${inj.memo_ids.length}</span>건, 주제 <span class="num">${inj.topic_ids.length}</span>개)` : ''}.</span></p>` : ''}
      <section class="memo__sec"><h3 class="memo__h">진행 상태</h3>
        ${h.done?.length || h.remaining?.length || h.notes ? html`<dl class="handoff">
          ${h.done?.length ? html`<dt>끝낸 일</dt><dd><ul>${h.done.map((x) => html`<li>${x}</li>`)}</ul></dd>` : ''}
          ${h.remaining?.length ? html`<dt>남은 일</dt><dd><ul>${h.remaining.map((x) => html`<li>${x}</li>`)}</ul></dd>` : ''}
          ${h.notes ? html`<dt>메모</dt><dd class="pre">${h.notes}</dd>` : ''}</dl>`
        : html`<p class="quiet-line">${s.status === 'open' ? '대화 중 일정한 턴마다, 그리고 세션이 끝나면 정리됩니다.' : '남긴 진행 상태가 없습니다.'}</p>`}
        ${states.length ? html`<p class="sdet__tags">진행 상태 메모: ${states.map((m) => html`${memoTag(m, { href: `#/memos/${m.id}` })} `)}</p>` : ''}
      </section>
      <section class="memo__sec"><h3 class="memo__h">추출된 메모 <span class="num muted">${extracted.length}</span></h3>
        ${extracted.length ? html`<ul class="rel">${extracted.map((m) => html`<li>${memoTag(m, { href: `#/memos/${m.id}` })}<span class="rel__kind">${STATUS_LABEL[m.status] || m.status}</span><span class="rel__body">${m.body}</span></li>`)}</ul>`
        : html`<p class="quiet-line">이 세션에서 뽑은 메모가 없습니다.</p>`}
      </section>
      <section class="memo__sec"><h3 class="memo__h">서버에 저장된 대화록</h3>
        ${s.transcript ? html`<p class="field__hint">긴 도구 출력은 줄이고 민감 정보는 가린 축약본입니다. ${fmtDate(s.ended_at || s.started_at)}부터 ${data.retention.transcript_days}일 동안 보존합니다.</p>
          <pre class="transcript">${s.transcript}</pre>` : html`<p class="quiet-line">저장된 대화록이 없습니다.</p>`}
      </section>
      <div class="sdet__danger"><button type="button" class="btn btn--sm danger-outline" id="s-del">${icon('trash', 'icon--sm')}<span>이 세션 삭제</span></button>
        <p class="field__hint">대화록과 이 세션에서 나온 미확인 후보·진행 상태를 지웁니다. 확인해서 정식이 된 메모는 남습니다.</p></div>
    </article>`);
    det.querySelector('#s-del').onclick = async (e) => {
      const ok = await confirmDialog({ title: '이 세션을 삭제할까요', body: `대화록과 이 세션에서 나온 미확인 후보, 진행 상태를 지웁니다. 확인해서 정식 메모가 된 것은 남습니다. 삭제한 세션은 되돌릴 수 없습니다.`, confirmLabel: '세션 삭제', danger: true });
      if (!ok) return;
      await busy(e.currentTarget, async () => {
        await api(`/api/sessions/${id}`, { method: 'DELETE', body: {} });
        toast('세션을 삭제했습니다.');
        emit('memo-saved', {});
        await loadList();
        selected = undefined;
        navigate(`#/sessions${platform ? `?platform=${platform}` : ''}`, { force: true });
      });
    };
  }
  function back() {
    return html`<a class="back" href="#/sessions${platform ? `?platform=${platform}` : ''}">${icon('chevron-right', 'icon--sm back__i')}<span>세션 목록</span></a>`;
  }

  async function update(c) {
    const p = c.query.platform || '';
    const id = c.params.id ? Number(c.params.id) : null;
    if (p !== platform || !root.querySelector('#ssplit')) {
      platform = p;
      paint();
      selected = undefined;
    }
    if (id !== selected) {
      selected = id;
      await showDetail(id);
      if (id && matchMedia('(max-width: 1023px)').matches) scrollTo(0, 0);
    }
  }
  paint();
  selected = undefined;
  await update(ctx);
  return { update };
}
