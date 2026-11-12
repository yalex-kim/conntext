/* markdown.js: 주제 문서 본문용 작은 마크다운 렌더러.
   지원: 제목(#~###), 목록(-, *, +, 1.), 인용(>), 코드 블록(```), 인라인 코드, 굵게(**), 문단.
   모든 글자는 먼저 이스케이프한 뒤 표시만 바꾼다. 서버 문자열이 그대로 HTML이 되는 경로는 없다.
   [m:12] 근거 표시는 opts.cite(id)가 돌려주는 html 조각으로, [t:3]은 주제 링크로 바꾼다. */
import { esc, html, raw } from './core.js';

function inline(text, opts) {
  // 인라인 코드를 먼저 떼어 두고 나머지만 꾸민다.
  return text
    .split(/(`[^`\n]+`)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return `<code>${esc(seg.slice(1, -1))}</code>`;
      let s = esc(seg);
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\[m:(\d+)\]/g, (_, id) => (opts.cite ? String(opts.cite(Number(id))) : `m:${id}`));
      s = s.replace(/\[t:(\d+)\]/g, (_, id) => `<a class="chip chip--mono" href="#/wiki/${id}">t:${id}</a>`);
      return s;
    })
    .join('');
}

export function renderMarkdown(src, opts = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items: [] }
  let quote = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), opts)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((t) => `<li>${inline(t, opts)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(' '), opts)}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('```')) {
      flushAll();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      out.push(`<pre class="md-code"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (!t) {
      flushAll();
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) {
      flushAll();
      const level = Math.min(4, m[1].length + 1); // 문서 제목이 h1이므로 한 단 내린다.
      out.push(`<h${level}>${inline(m[2], opts)}</h${level}>`);
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(t))) {
      flushPara();
      flushList();
      quote.push(m[1]);
      continue;
    }
    if ((m = /^([-*+]|\d+[.)])\s+(.*)$/.exec(t))) {
      flushPara();
      flushQuote();
      const tag = /^\d/.test(m[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}/.test(line)) {
      // 들여 쓴 줄은 앞 항목에 이어 붙인다.
      list.items[list.items.length - 1] += ' ' + t;
      continue;
    }
    flushList();
    flushQuote();
    para.push(t);
  }
  flushAll();
  return raw(out.join('\n'));
}

/** 근거 표시를 빼고 한 줄로 줄인다(목록의 발췌문 등). */
export function plain(src, n = 140) {
  const s = String(src || '').replace(/\[m:\d+\]|\[t:\d+\]|[#*`>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
export { html };
