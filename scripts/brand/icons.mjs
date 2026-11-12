// 아이콘 스프라이트 생성. 24 격자, 선 1.75, 둥근 끝·이음, currentColor.
// 사용: node scripts/brand/icons.mjs → web/assets/icons.svg
import { writeFileSync } from 'node:fs';
const OUT = new URL('../../web/assets/icons.svg', import.meta.url).pathname;
const I = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  wiki: '<path d="M12 6.5C10.3 5.2 7.8 4.5 4 4.5v14c3.8 0 6.3.7 8 2 1.7-1.3 4.2-2 8-2v-14c-3.8 0-6.3.7-8 2z"/><path d="M12 6.5v14"/>',
  memo: '<path d="M3.5 6.5h17l-3 5.5 3 5.5h-17z"/><path d="M7 12h6.5"/>',
  agent: '<rect x="4" y="7.5" width="16" height="12" rx="3"/><path d="M12 7.5V4.5"/><path d="M9.5 12.5v1.5M14.5 12.5v1.5"/><path d="M2 12.5v2M22 12.5v2"/>',
  session: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5"/><path d="M12.5 15H17"/>',
  team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5c.6-3 2.8-4.75 5.5-4.75s4.9 1.75 5.5 4.75"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4"/><path d="M17 15c1.8.6 3 2 3.5 4.5"/>',
  settings: '<path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/>',
  admin: '<path d="M5.07 18A8 8 0 1 1 18.93 18"/><path d="m12 14 4-4.5"/><path d="M12 7.5V9M7.4 9.4l1 1"/><path d="M8.5 20h7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H14a5.25 5.25 0 0 1 0 10.5h-3"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="m12.5 7.5 4 4"/>',
  trash: '<path d="M4.5 7h15M10 4h4"/><path d="m6.5 7 .8 12.1A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/><path d="M10 11v5.5M14 11v5.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5 11 13"/><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7h4"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5h-2A1.5 1.5 0 0 0 5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  play: '<path d="M7.5 5.5v13l11-6.5z"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.3 3 7.5 7 9 4-1.5 7-4.7 7-9V6z"/>',
  alert: '<path d="M10.7 4.8a1.5 1.5 0 0 1 2.6 0l7.4 13A1.5 1.5 0 0 1 19.4 20H4.6a1.5 1.5 0 0 1-1.3-2.2z"/><path d="M12 9.5V14M12 17v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.75v.01"/>',
  'chevron-down': '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  'chevron-right': '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  'arrow-right': '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 5.34l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1-1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  filter: '<path d="M4 5h16l-6 7.5v5l-4 2v-7z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M16.5 7l2.5 2.5M14 9.5l2 2"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3"/><path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3"/><path d="M17.3 3v3.7h-3.7M6.7 21v-3.7h3.7"/>',
};
const A = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const out = `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Conntext 아이콘. 사용: <svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#home"/></svg> -->\n` +
  Object.entries(I).map(([k, v]) => `<symbol id="${k}" viewBox="0 0 24 24" ${A}>${v}</symbol>`).join('\n') + '\n</svg>\n';
writeFileSync(OUT, out);
console.log(Object.keys(I).length, Object.keys(I).join(' '));
