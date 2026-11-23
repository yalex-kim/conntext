/* 에이전트: 세션 시작 때 에이전트가 받는 내용(프레임 포맷 그림), 구역별 항목, 원문, 최근 주입 기록 */
import {
  api, emptyState, errorState, fmtDateTime, fmtNum, html, icon, loading, memoTag, navigate, on, pageHead,
  platformName, projectChip, registerScreen, render, state, table, timeAgo, toast,
} from '../core.js';

const opts = { nav: 'agent', title: '에이전트', personal: true, group: 'agent' };
registerScreen('/agent', agentScreen, opts);

// 구역 정의: 그림의 필드 순서이자 색. 서버의 sections[].key와 맞춘다.
const FIELDS = [
  { key: 'instructions', name: '지시·선호', cls: 'f-mine' },
  { key: 'team_instructions', name: '팀 규칙', cls: 'f-team' },
  { key: 'state', name: '진행 상태', cls: 'f-state' },
  { key: 'procedures', name: '내 절차 색인', cls: 'f-mine-proc' },
  { key: 'team_procedures', name: '팀 절차 색인', cls: 'f-team-proc' },
  { key: 'topics', name: '내 지식 색인', cls: 'f-mine-idx' },
  { key: 'team_topics', name: '팀 지식 색인', cls: 'f-team-idx' },
];
const SECTION_TIER = { instructions: 'mine', team_instructions: 'team', state: 'state' };

async function agentScreen(root, ctx) {
  const projects = state.me.projects || [];
  render(root, html`
    ${pageHead('에이전트가 받는 내용', { sub: '저장소에서 세션을 시작하면 Conntext가 아래 내용을 에이전트에 넣습니다. 칸의 너비가 토큰 수이고, 예산을 넘는 항목은 들어가지 않습니다.' })}
    <nav class="tabs agent-tabs" aria-label="저장소 고르기" id="ag-tabs">
      ${projects.map((p) => html`<a href="#/agent?project=${encodeURIComponent(p.key)}" data-p="${p.key}"><span class="mono">${p.name}</span></a>`)}
      <a href="#/agent?project=" data-p="">저장소 밖</a>
    </nav>
    <div id="ag-preview"></div>
    <section class="sec" aria-labelledby="h-inj">
      <div class="sec__head"><h2 class="sec__title" id="h-inj">최근 주입 기록</h2><span class="sec__meta">세션을 시작할 때 실제로 넣은 기록입니다. 쓰인 메모는 에이전트가 답에 썼다고 알린 수입니다.</span></div>
      <div id="ag-inj">${loading()}</div>
    </section>`);
  const tabs = root.querySelector('#ag-tabs');
  const prev = root.querySelector('#ag-preview');
  let ro = null;

  async function show(c) {
    let pk = c.query.project;
    if (pk === undefined) {
      pk = projects[0]?.key || '';
      navigate(`#/agent?project=${encodeURIComponent(pk)}`, { replace: true });
      return;
    }
    tabs.querySelectorAll('[data-p]').forEach((a) => (a.dataset.p === pk ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    render(prev, loading('주입할 내용을 계산하는 중입니다'));
    let d;
    try {
      d = await api('/api/agent/preview', { query: { project: pk }, signal: ctx.signal });
    } catch (e) {
      if (e.name !== 'AbortError') render(prev, errorState(e));
      return;
    }
    paint(d, pk);
  }

  function paint(d, pk) {
    const name = pk ? pk.split('/').pop() : '';
    const secs = new Map(d.sections.map((s) => [s.key, s]));
    const secTokens = d.sections.reduce((a, s) => a + s.tokens, 0);
    const overhead = Math.max(0, d.tokens - secTokens);
    const dropped = d.sections.reduce((a, s) => a + (s.dropped || 0), 0);
    const items = d.sections.reduce((a, s) => a + s.items.length, 0);
    const empty = !d.tokens;
    render(prev, html`
      <figure class="ff" id="ff" aria-labelledby="ff-cap">
        <figcaption class="ff__cap" id="ff-cap">
          <span class="ff__title">${name ? html`<span class="mono">${name}</span>에서 세션을 시작할 때` : '저장소 밖에서 세션을 시작할 때'}</span>
          <span class="ff__sum">${empty ? '넣는 내용 없음' : html`<span class="num">${fmtNum(d.tokens)}</span> / <span class="num">${fmtNum(d.budget)}</span> 토큰 · 항목 <span class="num">${items}</span>개`}${dropped ? html` · <span class="warn-text">예산 때문에 <span class="num">${dropped}</span>개 빠짐</span>` : ''}</span>
        </figcaption>
        <div class="ff__frame" id="ff-frame"></div>
        <p class="sr-only">${FIELDS.map((f) => {
          const s = secs.get(f.key);
          return `${f.name} ${s ? `${s.tokens}토큰, 항목 ${s.items.length}개${s.dropped ? `, ${s.dropped}개 빠짐` : ''}` : '없음'}. `;
        }).join('')}안내문 ${overhead}토큰. 예산 ${d.budget}토큰 중 ${d.tokens}토큰 사용.</p>
      </figure>
      ${empty ? emptyState({ icon: 'agent', title: '이 저장소에서는 아직 넣을 내용이 없습니다', body: '지시·선호를 적거나, 이 저장소 범위로 메모를 저장하거나, 세션을 마쳐 진행 상태를 남기면 다음 세션부터 여기에 쌓입니다.' }) : ''}
      <div class="agent-secs">${FIELDS.map((f) => {
        const s = secs.get(f.key);
        if (!s) return '';
        const tier = SECTION_TIER[s.key];
        return html`<section class="asec" aria-labelledby="as-${s.key}">
          <header class="asec__head"><span class="swatch ${f.cls}" aria-hidden="true"></span><h3 class="asec__title" id="as-${s.key}">${s.title}</h3>
            <span class="asec__tok"><span class="num">${fmtNum(s.tokens)}</span> 토큰</span>
            ${s.key === 'instructions' && d.instruction_usage?.limit ? html`<span class="asec__usage${d.instruction_usage.chars > d.instruction_usage.limit ? ' warn-text' : ''}">글자 <span class="num">${fmtNum(d.instruction_usage.chars)}</span> / <span class="num">${fmtNum(d.instruction_usage.limit)}</span>자</span>` : ''}
            ${s.over_limit ? html`<span class="warn-text small">상한에 들어가지 않아 ${s.over_limit}개 빠짐. 합치거나 줄이세요</span>` : ''}
            ${s.dropped ? html`<span class="warn-text small">예산 초과로 ${s.dropped}개 빠짐</span>` : ''}</header>
          ${s.items.length ? html`<ul class="aitems">${s.items.map((it) => html`<li>
            <span class="aitems__ref">${it.memo_id ? memoTag({ id: it.memo_id, tier, author: s.key === 'team_instructions' ? it.tag : null }, { href: `#/memos/${it.memo_id}`, by: false })
              : html`<a class="chip chip--mono" href="#/wiki/${it.topic_id}" title="주제 문서">t:${it.topic_id}</a>`}</span>
            <span class="aitems__text">${it.text}${it.tag ? html` <span class="muted">(${it.tag})</span>` : ''}</span>
            <span class="aitems__tok num">${fmtNum(it.tokens)}</span></li>`)}</ul>`
            : s.over_limit ? html`<p class="quiet-line warn-text">지시·선호 ${s.over_limit}개가 모두 상한(개수 또는 글자)에 들어가지 않아 빠졌습니다. 비슷한 지시를 합치거나 긴 지시를 줄이세요.</p>`
            : html`<p class="quiet-line">예산이 남지 않아 이 구역은 통째로 빠졌습니다.</p>`}
        </section>`;
      })}</div>
      ${empty ? '' : html`<details class="rawtext">
        <summary>${icon('chevron-right', 'icon--sm rawtext__i')}에이전트가 받는 원문 전체 보기</summary>
        <div class="term"><div class="term__head"><span class="term__title">SessionStart 주입 · ${fmtNum(d.tokens)} 토큰</span>
          <button type="button" class="btn btn--quiet btn--sm" id="ag-copy">${icon('copy', 'icon--sm')}<span>복사</span></button></div>
          <pre>${d.text}</pre></div></details>`}`);
    const frame = prev.querySelector('#ff-frame');
    const draw = () => drawFrame(frame, d, secs, overhead);
    draw();
    ro?.disconnect();
    ro = new ResizeObserver(() => draw());
    ro.observe(frame);
    const cp = prev.querySelector('#ag-copy');
    if (cp) cp.onclick = async () => {
      try {
        await navigator.clipboard.writeText(d.text);
        toast('원문을 복사했습니다.');
      } catch {
        toast('복사하지 못했습니다. 원문을 직접 선택해 복사하세요.', { tone: 'error' });
      }
    };
  }

  async function loadInjections() {
    const host = root.querySelector('#ag-inj');
    try {
      const d = await api('/api/agent/injections', { signal: ctx.signal });
      if (!d.injections.length) {
        render(host, emptyState({ icon: 'clock', title: '아직 주입 기록이 없습니다', body: '플러그인을 설치하고 저장소에서 Claude Code나 OpenCode 세션을 시작하면 여기에 기록됩니다. 설치 방법은 설정의 연결에 있습니다.', action: html`<a class="btn" href="#/settings">설정 열기</a>` }));
        return;
      }
      const cols = [
          { label: '시각', cell: (r) => html`<span title="${fmtDateTime(r.created_at)}">${timeAgo(r.created_at)}</span>` },
          { label: '플랫폼', cell: (r) => platformName(r.platform) },
          { label: '저장소', cell: (r) => projectChip(r.project) },
          { label: '토큰', num: true, cell: (r) => fmtNum(r.tokens) },
          { label: '넣은 메모', num: true, cell: (r) => r.memo_ids.length },
          { label: '넣은 주제', num: true, cell: (r) => r.topic_ids.length },
          { label: '답에 쓰인 메모', num: true, cell: (r) => (r.used ? html`<strong>${r.used}</strong>` : html`<span class="muted">0</span>`) },
      ];
      render(host, table({
        caption: '최근 주입 기록',
        columns: cols,
        rows: d.injections.slice(0, 10),
      }));
      if (d.injections.length > 10) {
        host.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn--sm inj-more">최근 30건 모두 보기</button>`);
        host.querySelector('.inj-more').onclick = () => {
          render(host, table({ caption: '최근 주입 기록', columns: cols, rows: d.injections }));
        };
      }
    } catch (e) {
      if (e.name !== 'AbortError') render(host, errorState(e));
    }
  }

  await show(ctx);
  loadInjections();
  return { update: (c) => show(c), destroy: () => ro?.disconnect() };
}

/**
 * 프레임 포맷 그림. 가로 막대 전체가 예산이고, 구역이 필드로 나뉜다. 위에 토큰 눈금.
 * 넓은 화면에서는 필드마다 지시선을 아래로 내려 이름표를 계단식으로 단다(선이 서로 엇갈리지 않게 오른쪽 필드부터 위에).
 * 좁아서 이름표가 안 들어가면 번호를 단 범례 목록으로 바꾼다.
 */
function drawFrame(frame, d, secs, overhead) {
  const W = frame.clientWidth;
  if (!W) return;
  const scale = Math.max(d.budget, d.tokens) || 1;
  const pct = (t) => (t / scale) * 100;
  const fields = [];
  let x = 0;
  if (overhead) {
    fields.push({ key: 'overhead', name: '안내문', cls: 'f-overhead', tokens: overhead, x, note: '머리말과 꼬리말' });
    x += overhead;
  }
  for (const f of FIELDS) {
    const s = secs.get(f.key);
    if (!s) continue;
    fields.push({ ...f, tokens: s.tokens, x, n: s.items.length, dropped: s.dropped });
    x += s.tokens;
  }
  const free = Math.max(0, d.budget - x);
  const absent = FIELDS.filter((f) => !secs.has(f.key));
  // 예산이 모자라 빠진 구역과, 지시 상한(개수·글자) 때문에 빠진 구역은 이유가 달라 따로 적는다.
  const starved = FIELDS.filter((f) => secs.has(f.key) && !secs.get(f.key).tokens && !secs.get(f.key).over_limit);
  const capped = FIELDS.filter((f) => secs.has(f.key) && !secs.get(f.key).tokens && secs.get(f.key).over_limit);
  // 눈금
  const steps = [50, 100, 250, 500, 1000, 2000];
  const maxTicks = W < 520 ? 4 : 8;
  const step = steps.find((s) => scale / s <= maxTicks) || 5000;
  const ticks = [];
  for (let t = 0; t <= scale + 0.1; t += step / 5) ticks.push(t);
  const drawn = fields.filter((f) => f.tokens > 0);
  numberFields(drawn);
  // 이름표 계단: 오른쪽 필드가 맨 위
  const ROW = 44;
  const LABEL_W = 230;
  const stair = [...drawn].reverse();
  const fits = stair.every((f) => (pct(f.x + f.tokens / 2) / 100) * W + 10 + LABEL_W <= W);
  const mode = fits && W >= 560 ? 'stair' : 'list';
  const inside = (f) => (pct(f.tokens) / 100) * W;
  const labelOf = (f) => html`<span class="ff__lname">${f.name}</span> <span class="ff__ltok"><span class="num">${fmtNum(f.tokens)}</span> 토큰</span>
    ${f.n != null ? html`<span class="ff__lmeta">항목 ${f.n}개${f.dropped ? html` · <span class="warn-text">${f.dropped}개 빠짐</span>` : ''}</span>` : html`<span class="ff__lmeta">${f.note}</span>`}`;

  render(frame, html`
    <div class="ff__ruler" aria-hidden="true">
      ${ticks.map((t) => {
        const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        // 예산 표시와 겹치는 끝쪽 눈금 숫자는 생략한다
        const nearBudget = Math.abs(pct(t) - pct(d.budget)) * W / 100 < 64 && t !== 0;
        if (major && nearBudget) return html`<span class="ff__tick is-major" style="left:${pct(t)}%"></span>`;
        return html`<span class="ff__tick${major ? ' is-major' : ''}" style="left:${pct(t)}%">${major ? html`<span class="ff__tl num">${fmtNum(Math.round(t))}</span>` : ''}</span>`;
      })}
    </div>
    <div class="ff__bar${d.tokens ? '' : ' is-empty'}" aria-hidden="true">
      ${drawn.map((f) => {
        const px = inside(f);
        const label = px >= f.name.length * 14 + 56 ? html`<span class="ff__fname">${f.name}</span><span class="ff__ftok num">${fmtNum(f.tokens)}</span>`
          : px >= 22 ? html`<span class="ff__fno num">${f.no}</span>` : '';
        return html`<span class="ff__field ${f.cls}${px < 6 ? ' is-thin' : ''}" style="left:${pct(f.x)}%;width:${pct(f.tokens)}%" title="${f.name} ${fmtNum(f.tokens)} 토큰">${label}</span>`;
      })}
      ${free ? html`<span class="ff__field f-free" style="left:${pct(x)}%;width:${pct(free)}%">${(pct(free) / 100) * W > 120 ? html`<span class="ff__fname">남은 예산</span><span class="ff__ftok num">${fmtNum(free)}</span>` : ''}</span>` : ''}
      ${d.tokens ? '' : html`<span class="ff__emptytext">넣는 내용 없음 · 세션 시작 때 아무것도 넣지 않습니다</span>`}
      <span class="ff__budget" style="left:${pct(d.budget)}%"><span class="ff__budget-l">예산 <span class="num">${fmtNum(d.budget)}</span></span></span>
    </div>
    ${drawn.length ? mode === 'stair' ? html`
      <div class="ff__callouts" style="height:${stair.length * ROW + 8}px">
        <svg class="ff__lines" width="${W}" height="${stair.length * ROW + 8}" aria-hidden="true">
          ${stair.map((f, i) => {
            const cx = Math.round((pct(f.x + f.tokens / 2) / 100) * W) + 0.5;
            const y = i * ROW + 16;
            return html`<path d="M${cx} 0 V${y} H${cx + 8}"/><circle cx="${cx}" cy="0" r="2.5"/>`;
          })}
        </svg>
        ${stair.map((f, i) => {
          const cx = (pct(f.x + f.tokens / 2) / 100) * W;
          return html`<div class="ff__label" style="left:${cx + 12}px;top:${i * ROW + 6}px"><span class="swatch ${f.cls}" aria-hidden="true"></span><span>${labelOf(f)}</span></div>`;
        })}
      </div>`
      : html`<ol class="ff__legend">${drawn.map((f) => html`<li><span class="swatch ${f.cls}" aria-hidden="true"><span class="num">${f.no}</span></span><span>${labelOf(f)}</span></li>`)}</ol>`
    : ''}
    ${capped.length ? html`<p class="ff__absent warn-text">상한에 들어가지 않아 모두 빠진 구역: ${capped.map((f, i) => html`${i ? ', ' : ''}${f.name} ${secs.get(f.key).over_limit}개`)}</p>` : ''}
    ${starved.length ? html`<p class="ff__absent warn-text">예산이 모자라 통째로 빠진 구역: ${starved.map((f, i) => html`${i ? ', ' : ''}${f.name} ${secs.get(f.key).dropped}개`)}</p>` : ''}
    ${absent.length ? html`<p class="ff__absent">비어 있는 구역: ${absent.map((f, i) => html`${i ? ', ' : ''}${f.name}`)}${secs.has('state') || !d.project_key ? '' : ' (이 저장소에 남은 진행 상태가 없습니다)'}${!d.project_key ? ' · 저장소 밖에서는 진행 상태와 저장소 범위 지식이 들어가지 않습니다' : ''}</p>` : ''}`);
}
function numberFields(list) {
  list.forEach((f, i) => (f.no = i + 1));
}
