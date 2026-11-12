/* memo-view.js: 메모 상세(메모 화면과 위키 옆 패널이 함께 쓴다), 팀으로 공유 대화상자, 신고 대화상자. */
import {
  api, busy, emit, errorState, fmtDate, fmtNum, html, icon, KIND_LABEL, loading, memoTag, on, openDialog, platformName,
  projectChip, render, SOURCE_LABEL, STATUS_LABEL, teamSpaces, tierOf, TIER_LABEL, timeAgo, toast, $,
} from './core.js';
import { showReceipt } from './shell.js';

// 종류마다 에이전트에 들어가는 방식. 고르는 자리에서 보여 준다.
export const KIND_EFFECT = {
  instruction: '세션을 시작할 때마다 항상 에이전트에 들어갑니다. 저장소 범위면 그 저장소에서만 들어갑니다.',
  knowledge: '주제 문서에 묶입니다. 세션 시작 때는 주제 제목만 색인으로 들어가고, 본문은 관련 있을 때 에이전트가 검색해 꺼냅니다.',
  state: '같은 저장소의 다음 세션이 이어받는 진행 상태가 됩니다. 보존 기간이 지나면 만료되고 주제 문서에서는 빠집니다.',
};
const USE_LABEL = { inject: '세션 시작에 주입', recall: '검색 결과에 나옴', used: '에이전트가 답에 씀' };

/**
 * 메모 상세를 container에 그린다.
 * opts.panel: 옆 패널 모드(제목 줄에 닫기 버튼), opts.onClose, opts.onChange(kind, payload)
 * kind: 'edited' {memo_id} | 'deleted' | 'confirmed' | 'dismissed' | 'promoted'
 */
export async function renderMemoDetail(container, id, opts = {}) {
  render(container, loading('메모를 불러오는 중입니다'));
  let m;
  try {
    m = await api(`/api/memos/${id}`, { signal: opts.signal });
  } catch (e) {
    if (e.name === 'AbortError') return;
    render(container, html`${opts.panel ? panelHead(null, opts) : ''}${errorState(e, { retry: false })}`);
    bindClose(container, opts);
    return;
  }
  paint();

  function paint(editing = false) {
    const tier = tierOf(m);
    const active = m.status === 'active';
    const mine = m.space_kind === 'personal';
    const prev = m.history.previous || [];
    const next = m.history.next || [];
    const uses = Object.entries(m.uses || {});
    const otherLinks = (m.links || []).filter((l) => l.relation !== 'supersedes');
    render(container, html`<article class="memo" aria-labelledby="memo-${m.id}-h">
      ${opts.panel ? panelHead(m, opts) : ''}
      <header class="memo__head">
        <h2 class="memo__title" id="memo-${m.id}-h">${memoTag(m, { lg: true })}<span class="memo__tier">${TIER_LABEL[tier]}</span></h2>
        ${!active && tier !== 'superseded' ? html`<span class="chip">${STATUS_LABEL[m.status] || m.status}</span>` : ''}
      </header>
      ${tier === 'candidate' && active ? html`<p class="memo__note">${icon('info', 'icon--sm')}<span>세션에서 자동으로 추출했고 아직 확인하지 않은 후보입니다. 확인하기 전에는 에이전트에 지식으로 들어가지 않습니다.</span></p>` : ''}
      ${m.status === 'superseded' && next[0] ? html`<p class="memo__note">${icon('info', 'icon--sm')}<span>이 메모는 ${memoTag(next[0], { href: `#/memos/${next[0].id}`, tier: next[0].status === 'superseded' ? 'superseded' : mine ? 'mine' : 'team' })}가 대체했습니다. 원문은 그대로 보존됩니다.</span></p>` : ''}
      ${editing ? editForm() : html`<div class="memo__body">${m.body}</div>`}
      ${editing ? '' : html`<div class="memo__actions">${actions(tier, active, mine)}</div>`}
      <dl class="facts">
        <div><dt>종류</dt><dd>${KIND_LABEL[m.kind] || m.kind}${active && m.can_edit && !editing ? html`<button type="button" class="btn btn--quiet btn--sm" data-act="kind" aria-expanded="false" aria-controls="kind-form-${m.id}">${icon('edit', 'icon--sm')}<span>종류 바꾸기</span></button>` : ''}</dd></div>
        <div class="facts__wide" id="kind-slot-${m.id}"></div>
        <div><dt>범위</dt><dd>${projectChip(m.scope === 'project' ? m.project : '')}</dd></div>
        <div><dt>출처</dt><dd>${SOURCE_LABEL[m.source] || m.source}${m.masked_count ? html` · 민감 정보 ${m.masked_count}건 마스킹` : ''}</dd></div>
        <div><dt>공간</dt><dd>${mine ? '내 공간' : m.space_name} · ${m.author_name}</dd></div>
        <div><dt>저장</dt><dd>${timeAgo(m.created_at)}</dd></div>
        ${m.expires_at ? html`<div><dt>만료</dt><dd>${fmtDate(m.expires_at)}</dd></div>` : ''}
        <div><dt>쓰인 횟수</dt><dd>${uses.length ? uses.map(([k, n]) => html`<span class="use">${USE_LABEL[k] || k} <span class="num">${fmtNum(n)}</span>회</span>`) : '아직 쓰이지 않았습니다'}</dd></div>
      </dl>
      ${m.topics?.length ? html`<section class="memo__sec"><h3 class="memo__h">소속 주제</h3>
        <ul class="linklist">${m.topics.map((t) => html`<li><a href="#/wiki/${t.id}">${icon('wiki', 'icon--sm')}${t.title}</a></li>`)}</ul></section>` : ''}
      ${prev.length || next.length ? html`<section class="memo__sec"><h3 class="memo__h">대체 이력</h3>
        <ol class="chain">
          ${prev.map((p) => chainRow(p, 'superseded', '이전 판'))}
          <li class="chain__row is-current">${memoTag(m)}<span class="chain__role">이 메모</span><span class="chain__date">${fmtDate(m.created_at)}</span><p class="chain__body">${m.body}</p></li>
          ${next.map((n) => chainRow(n, n.status === 'superseded' ? 'superseded' : mine ? 'mine' : 'team', '이후 판'))}
        </ol></section>` : ''}
      ${otherLinks.length ? html`<section class="memo__sec"><h3 class="memo__h">연결된 메모</h3>
        <ul class="rel">${otherLinks.map((l) => html`<li>${memoTag({ ...l.memo, space_kind: m.space_kind }, { href: `#/memos/${l.memo.id}`, by: false })}
          <span class="rel__kind">${relLabel(l)}</span><span class="rel__body">${l.memo.body}</span></li>`)}</ul></section>` : ''}
      ${m.session ? html`<section class="memo__sec"><h3 class="memo__h">출처 세션</h3>
        <p><a href="#/sessions/${m.session.id}">${platformName(m.session.platform)} · ${fmtDate(m.session.started_at)}</a> <span class="muted">${m.session.summary || ''}</span></p></section>` : ''}
      ${m.shared_to?.length || m.origin ? html`<section class="memo__sec"><h3 class="memo__h">공유</h3>
        <ul class="linklist">
          ${m.origin ? html`<li>원본: <a href="#/memos/${m.origin.id}">m:${m.origin.id}</a> (${m.origin.space})</li>` : ''}
          ${(m.shared_to || []).map((s) => html`<li>${s.team}에 올린 사본: <a href="#/memos/${s.id}">m:${s.id}</a></li>`)}
        </ul></section>` : ''}
    </article>`);
    bindClose(container, opts);
    bind();
  }

  function chainRow(p, tier, role) {
    return html`<li class="chain__row">${memoTag({ ...p }, { href: `#/memos/${p.id}`, tier })}<span class="chain__role">${role}</span>
      <span class="chain__date">${fmtDate(p.created_at)}</span><p class="chain__body">${p.body}</p></li>`;
  }
  function relLabel(l) {
    const r = l.relation;
    if (r === 'supplements') return l.dir === 'out' ? '보충함' : '보충받음';
    if (r === 'duplicate') return '같은 내용';
    return '관련';
  }
  function actions(tier, active, mine) {
    if (!active) return html`<span class="muted small">유효한 메모만 고치거나 공유할 수 있습니다.</span>`;
    const out = [];
    if (tier === 'candidate') {
      out.push(html`<button type="button" class="btn btn--primary btn--sm" data-act="confirm">${icon('check', 'icon--sm')}<span>확인해서 정식 메모로</span></button>`);
      out.push(html`<button type="button" class="btn btn--sm" data-act="dismiss">${icon('x', 'icon--sm')}<span>버림</span></button>`);
    }
    if (m.can_edit) out.push(html`<button type="button" class="btn btn--sm" data-act="edit">${icon('edit', 'icon--sm')}<span>고치기</span></button>`);
    if (mine && tier !== 'candidate' && m.kind !== 'state' && teamSpaces().length) out.push(html`<button type="button" class="btn btn--sm" data-act="promote">${icon('share', 'icon--sm')}<span>팀으로 공유</span></button>`);
    if (!mine) out.push(html`<button type="button" class="btn btn--sm" data-act="report">${icon('alert', 'icon--sm')}<span>신고</span></button>`);
    if (m.can_edit) out.push(html`<button type="button" class="btn btn--quiet btn--sm memo__del" data-act="delete">${icon('trash', 'icon--sm')}<span>삭제</span></button>`);
    return out;
  }
  function editForm() {
    return html`<form class="memo__edit" id="memo-edit-form">
      <label class="field__label" for="memo-edit">고친 내용</label>
      <textarea class="textarea" id="memo-edit" rows="5">${m.body}</textarea>
      <p class="field__hint">원문 m:${m.id}는 고치지 않고 그대로 남습니다. 고친 내용은 새 메모로 저장되어 m:${m.id}를 대체하고, 대체 이력에서 둘 다 볼 수 있습니다. 저장한 뒤 되돌릴 수 있습니다.</p>
      <div class="memo__edit-acts"><button type="submit" class="btn btn--primary btn--sm">새 판으로 저장</button><button type="button" class="btn btn--sm" data-act="cancel-edit">취소</button></div>
    </form>`;
  }
  function bind() {
    const root = container;
    const handle = (sel, fn) => root.querySelector(sel)?.addEventListener('click', (e) => fn(e.currentTarget));
    handle('[data-act="edit"]', () => {
      paint(true);
      const ta = root.querySelector('#memo-edit');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      root.querySelector('[data-act="cancel-edit"]').onclick = () => paint(false);
      root.querySelector('#memo-edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text || text === m.body.trim()) {
          ta.setAttribute('aria-invalid', 'true');
          toast(text ? '바뀐 내용이 없습니다. 고친 뒤 저장하세요.' : '내용이 비어 있습니다.', { tone: 'error' });
          return;
        }
        const btn = e.submitter || root.querySelector('#memo-edit-form [type=submit]');
        await busy(btn, async () => {
          const res = await api(`/api/memos/${m.id}`, { method: 'PUT', body: { text } });
          showReceipt(res, { title: `m:${m.id}를 고쳤습니다` });
          emit('memo-saved', res);
          opts.onChange?.('edited', res);
        });
      };
    });
    handle('[data-act="kind"]', (btn) => {
      const slot = root.querySelector(`#kind-slot-${m.id}`);
      if (slot.firstChild) {
        slot.replaceChildren();
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      btn.setAttribute('aria-expanded', 'true');
      render(slot, html`<form class="kindform" id="kind-form-${m.id}">
        <fieldset><legend class="kindform__lg">어떤 종류로 바꿀까요? 본문은 그대로이고 새 판을 만들지 않습니다.</legend>
        ${['instruction', 'knowledge', 'state'].map((k) => html`<label class="kindopt${k === m.kind ? ' is-now' : ''}">
          <input type="radio" name="kind" value="${k}" ${k === m.kind ? 'checked disabled' : ''}>
          <span class="kindopt__t"><strong>${KIND_LABEL[k]}</strong>${k === m.kind ? html` <span class="chip">지금</span>` : ''}</span>
          <span class="kindopt__d">${KIND_EFFECT[k]}</span></label>`)}
        </fieldset>
        <div class="memo__edit-acts"><button type="submit" class="btn btn--primary btn--sm" disabled>종류 바꾸기</button><button type="button" class="btn btn--sm" data-kind-cancel>취소</button></div>
      </form>`);
      const form = slot.querySelector('form');
      const submit = form.querySelector('[type=submit]');
      form.addEventListener('change', () => (submit.disabled = !form.querySelector('input:checked:not(:disabled)')));
      form.querySelector('[data-kind-cancel]').onclick = () => {
        slot.replaceChildren();
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      };
      form.querySelector('input:not(:disabled)')?.focus();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const kind = form.querySelector('input:checked:not(:disabled)')?.value;
        if (!kind) return;
        await busy(submit, async () => {
          const res = await api(`/api/memos/${m.id}`, { method: 'PUT', body: { kind } });
          showReceipt(res, { undoneText: `m:${m.id}의 종류를 ${KIND_LABEL[m.kind]}(으)로 되돌렸습니다.` });
          emit('memo-saved', res);
          opts.onChange?.('kind', res);
        });
      };
    });
    handle('[data-act="delete"]', (b) => busy(b, async () => {
      const res = await api(`/api/memos/${m.id}`, { method: 'DELETE', body: {} });
      toast(`${res.message.split('\n')[0]}. 7일 안에는 되돌릴 수 있습니다.`, {
        action: { label: '되돌리기', run: async () => {
          await api(`/api/events/${res.event_id}/undo`, { method: 'POST', body: {} });
          toast(`m:${m.id}를 되살렸습니다.`);
          emit('memo-saved', {});
          opts.onChange?.('restored', { memo_id: m.id });
        } },
      });
      emit('memo-saved', res);
      opts.onChange?.('deleted', res);
    }));
    handle('[data-act="confirm"]', (b) => busy(b, async () => {
      const res = await api(`/api/memos/${m.id}/confirm`, { method: 'POST', body: {} });
      toast(`m:${m.id}: ${res.message}`, { action: undoAction(res.event_id) });
      emit('memo-saved', res);
      opts.onChange?.('confirmed', res);
    }));
    handle('[data-act="dismiss"]', (b) => busy(b, async () => {
      const res = await api(`/api/memos/${m.id}/dismiss`, { method: 'POST', body: {} });
      toast(`m:${m.id}: ${res.message}`, { action: undoAction(res.event_id) });
      emit('memo-saved', res);
      opts.onChange?.('dismissed', res);
    }));
    handle('[data-act="promote"]', async () => {
      const ok = await promoteDialog({ memoIds: [m.id] });
      if (ok) opts.onChange?.('promoted', ok);
    });
    handle('[data-act="report"]', () => reportDialog(m));
  }
}

function panelHead(m, opts) {
  return html`<div class="panel-head"><span class="panel-head__t">${m ? '근거 메모' : '메모'}</span>
    ${m ? html`<a class="btn btn--quiet btn--sm" href="#/memos/${m.id}">${icon('external', 'icon--sm')}<span>메모 화면에서 열기</span></a>` : ''}
    <button type="button" class="btn btn--quiet btn--sm btn--icon" data-act="close-panel" aria-label="메모 패널 닫기">${icon('x')}</button></div>`;
}
function bindClose(container, opts) {
  const b = container.querySelector('[data-act="close-panel"]');
  if (b && opts.onClose) b.onclick = opts.onClose;
}

export function undoAction(eventId, after) {
  return { label: '되돌리기', run: async () => {
    const r = await api(`/api/events/${eventId}/undo`, { method: 'POST', body: {} });
    toast(r.message);
    emit('memo-saved', {});
    after?.();
  } };
}

// ── 팀으로 공유 ─────────────────────────────────────────────────────
/** 미리보기(dry_run)를 받아 보여 주고, 확인을 받아 올린다. 올렸으면 서버 응답을, 아니면 null을 돌려준다. */
export async function promoteDialog({ memoIds, topicId, title } = {}) {
  const teams = teamSpaces();
  if (!teams.length) {
    toast('소속된 팀이 없어 팀으로 공유할 수 없습니다. 팀 관리자에게 초대를 요청하세요.', { tone: 'error' });
    return null;
  }
  let preview = null;
  let teamId = teams[0].id;
  const body = (memoIds ? { memo_ids: memoIds } : { topic_id: topicId });
  const dlg = openDialog({
    title: title || '팀으로 공유',
    wide: true,
    body: html`<div id="pm-body">${loading('올라갈 내용을 확인하는 중입니다')}</div>`,
    actions: [
      { label: '취소', value: null },
      { label: '팀으로 공유', kind: 'primary', run: async () => {
        const note = dlg.el.querySelector('#pm-note')?.value.trim() || undefined;
        const ack = !!dlg.el.querySelector('#pm-ack')?.checked;
        const res = await api('/api/promote', { method: 'POST', body: { ...body, team_space_id: teamId, ack, note } });
        if (res.dry_run) {
          // 확인이 필요한데 빠졌다. 미리보기를 다시 그린다.
          preview = res;
          paint();
          return false;
        }
        const evs = (res.created || []).map((c) => c.event_id).filter(Boolean);
        toast(res.message, { action: evs.length ? { label: '되돌리기', run: async () => {
          for (const ev of evs) await api(`/api/events/${ev}/undo`, { method: 'POST', body: {} });
          toast('팀에 올린 사본을 거둬들였습니다. 원본은 그대로입니다.');
          emit('memo-saved', {});
        } } : undefined });
        emit('memo-saved', res);
        dlg.result = res;
        return true;
      } },
    ],
  });
  const submit = dlg.el.querySelector('[data-dlg-act="1"]');
  submit.disabled = true;

  async function load() {
    render(dlg.el.querySelector('#pm-body'), loading('올라갈 내용을 확인하는 중입니다'));
    submit.disabled = true;
    try {
      preview = await api('/api/promote', { method: 'POST', body: { ...body, team_space_id: teamId, dry_run: true } });
    } catch (e) {
      render(dlg.el.querySelector('#pm-body'), errorState(e, { retry: false }));
      return;
    }
    paint();
  }
  function paint() {
    const p = preview;
    const host = dlg.el.querySelector('#pm-body');
    const ackW = p.warnings.filter((w) => w.level === 'ack');
    const infoW = p.warnings.filter((w) => w.level !== 'ack');
    render(host, html`
      ${teams.length > 1 ? html`<div class="field pm-team"><label class="field__label" for="pm-team">올릴 팀</label>
        <select class="select" id="pm-team">${teams.map((t) => html`<option value="${t.id}" ${t.id === teamId ? 'selected' : ''}>${t.name}</option>`)}</select></div>`
        : html`<p class="pm-lead">${p.team}의 구성원 모두가 보게 되고, 구성원의 에이전트에도 팀 지식으로 들어갑니다. 내 공간의 원본은 그대로 남고 팀에는 출처가 붙은 사본이 올라갑니다.</p>`}
      <h3 class="pm-h">올라갈 내용 <span class="num">${p.items.length}</span>건</h3>
      ${p.items.length ? html`<ul class="pm-list">${p.items.map((it) => html`<li>${memoTag({ id: it.memo_id, tier: 'mine' })}
          <div><p class="pm-body">${it.body}</p>${it.topics.length ? html`<p class="pm-meta">주제: ${it.topics.join(', ')}</p>` : ''}</div></li>`)}</ul>`
        : html`<p class="muted">올릴 수 있는 메모가 없습니다. 아래 이유를 확인하세요.</p>`}
      ${ackW.length ? html`<div class="alert alert--warn" role="alert">${icon('alert')}<div><p class="alert__title">확인이 필요합니다</p>
        <ul>${ackW.map((w) => html`<li>m:${w.memo_id}: ${w.text}</li>`)}</ul></div></div>` : ''}
      ${infoW.length ? html`<div class="alert">${icon('info')}<div><p class="alert__title">참고</p><ul>${infoW.map((w) => html`<li>m:${w.memo_id}: ${w.text}</li>`)}</ul></div></div>` : ''}
      ${p.blocked.length ? html`<h3 class="pm-h">올리지 않는 항목 <span class="num">${p.blocked.length}</span>건</h3>
        <ul class="pm-blocked">${p.blocked.map((b) => html`<li><span class="mono">m:${b.memo_id}</span> ${b.reason}</li>`)}</ul>` : ''}
      ${p.items.length ? html`<div class="field"><label class="field__label" for="pm-note">팀에 남길 말 (선택)</label>
        <input class="input" id="pm-note" maxlength="200" placeholder="예: 11/4 회의에서 정한 내용입니다"><p class="field__hint">감사 기록에 함께 남습니다.</p></div>` : ''}
      ${p.need_ack && p.items.length ? html`<label class="check pm-ack"><input type="checkbox" id="pm-ack"> 위 내용을 팀 전원이 봐도 된다는 것을 확인했습니다</label>` : ''}`);
    const ack = host.querySelector('#pm-ack');
    const sync = () => (submit.disabled = !p.items.length || (p.need_ack && !ack?.checked));
    sync();
    ack?.addEventListener('change', sync);
    host.querySelector('#pm-team')?.addEventListener('change', (e) => {
      teamId = Number(e.target.value);
      load();
    });
  }
  load();
  const v = await dlg.done;
  return v && v !== true ? v : dlg.result || null;
}

// ── 신고 ────────────────────────────────────────────────────────────
export function reportDialog(m) {
  const dlg = openDialog({
    title: `m:${m.id} 신고`,
    body: html`<p class="muted">틀렸거나 오래된 팀 지식을 팀 관리자에게 알립니다. 관리자가 확인한 뒤 내리거나 그대로 둡니다.</p>
      <blockquote class="quote">${m.body}</blockquote>
      <div class="field"><label class="field__label" for="rp-reason">무엇이 문제인가요</label>
        <textarea class="textarea" id="rp-reason" rows="3" placeholder="예: broker 2.4부터는 순서 제약이 없어졌습니다"></textarea>
        <p class="field__error" id="rp-err" hidden></p></div>
      <label class="check"><input type="checkbox" id="rp-share"> 처리하는 사람이 이 메모 내용을 봐도 됩니다</label>`,
    actions: [
      { label: '취소', value: false },
      { label: '신고', kind: 'primary', run: async () => {
        const ta = dlg.el.querySelector('#rp-reason');
        const reason = ta.value.trim();
        const err = dlg.el.querySelector('#rp-err');
        if (reason.length < 4) {
          ta.setAttribute('aria-invalid', 'true');
          err.hidden = false;
          err.textContent = '무엇이 문제인지 네 글자 이상 적어 주세요.';
          ta.focus();
          return false;
        }
        const r = await api('/api/reports', { method: 'POST', body: { memo_id: m.id, reason, share_content: dlg.el.querySelector('#rp-share').checked } });
        toast(`${r.message} 팀 관리자가 확인합니다.`);
        return true;
      } },
    ],
  });
  return dlg.done;
}

export { on, $ };
