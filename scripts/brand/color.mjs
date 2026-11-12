// OKLCH -> sRGB hex, WCAG contrast. 사용: node color.mjs
export function oklch(L, C, H) {
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const clip = lin.some(v => v < -0.001 || v > 1.001);
  const rgb = lin.map(v => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
  return { lin: lin.map(v => Math.min(1, Math.max(0, v))), hex: '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), clip };
}
const Y = c => 0.2126 * c.lin[0] + 0.7152 * c.lin[1] + 0.0722 * c.lin[2];
export const contrast = (a, b) => { const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
if (import.meta.url === `file://${process.argv[1]}`) {
  const T = Object.fromEntries(process.argv.slice(2).map(s => { const [k, v] = s.split('='); return [k, oklch(...v.split(',').map(Number))]; }));
  for (const [k, v] of Object.entries(T)) console.log(k.padEnd(14), v.hex, v.clip ? 'CLIPPED' : '');
  const pairs = [['ink','ground'],['ink-2','ground'],['ink-2','surface'],['ink-3','ground'],['ink','marker'],['ink-2','marker'],['white','team'],['ink','state'],['white','state'],['ink','warn'],['white','danger'],['danger','ground'],['team','ground'],['state-ink','ground'],['warn-ink','ground'],['ground','ink'],['line-ink','ink'],['ink-3','ink']];
  for (const [a, b] of pairs) if (T[a] && T[b]) console.log(`${a} on ${b}`.padEnd(24), contrast(T[a], T[b]).toFixed(2));
}
