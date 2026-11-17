// conntext 인트로: 워드마크의 노란 conn 라벨이 nn만 품은 채 줄어들어 심볼(노치 있는 라벨 태그)이 된다.
// mountIntro(svg)는 1920×1080 viewBox의 <svg>에 장면을 그리고 { render(t), duration }를 돌려준다.
// /intro.html(영상 렌더용)과 소개 페이지 첫 방문 인트로가 같이 쓴다.

const WM = {
  label: { x: 0, y: -15, w: 210.5, h: 66, r: 9 },
  conn: [
    [18.25, "M30.95 5.5A18 18 0 1 0 30.95 30.5"],
    [67.25, "M18 0A18 18 0 1 1 18 36A18 18 0 1 1 18 0Z"],
    [117.25, "M0 36V15A15 15 0 0 1 30 15V36"],
    [163.25, "M0 36V15A15 15 0 0 1 30 15V36"],
  ],
  text: [
    [223.75, "M7 -13V25A11 11 0 0 0 18 36H19M0 0H18"],
    [254.75, "M0 18H36A18 18 0 1 0 31.38 30.04"],
    [304.25, "M0 0L28 36M28 0L0 36"],
    [345.75, "M7 -13V25A11 11 0 0 0 18 36H19M0 0H18"],
  ],
}
// 심볼(mark.svg). 아이콘 단위 64.
const MARK = {
  tag: { x: 6, y: 14, w: 52, h: 36, rl: 4.5, rr: 0, notch: 9 },
  n1: "M12.5 40.5V30A5.5 5.5 0 0 1 23.5 30V40.5",
  n2: "M30.5 40.5V30A5.5 5.5 0 0 1 41.5 30V40.5",
  stroke: 5.5,
}
const C = { ink: "#101a2d", yellow: "#f7d22a", ground: "#f4f7fa" }
const NS = "http://www.w3.org/2000/svg"
export const DURATION = 6.0
export const SETTLED = 5.15 // 워드마크가 제자리에 놓이는 시각
export const ICON_DONE = 3.25 // 잉크 칸까지 펼쳐져 심볼이 완성되는 시각
export const ICON_BOX = { x: 740, y: 320, size: 440 } // 그때 심볼이 놓인 자리(viewBox 좌표)

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const seg = (t, a, b) => clamp((t - a) / (b - a))
const lerp = (a, b, p) => a + (b - a) * p
const outC = (p) => 1 - Math.pow(1 - p, 3)
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const lerpShape = (a, b, p) => Object.fromEntries(Object.keys(a).map((k) => [k, lerp(a[k], b[k], p)]))

// 라벨 모양: 왼쪽 모서리(rl), 오른쪽 모서리(rr), 오른쪽 V자 노치 깊이(notch).
// 워드마크 라벨과 심볼의 태그를 같은 식으로 그려 모핑한다.
function labelPath({ x, y, w, h, rl, rr, notch }) {
  const R = x + w, B = y + h
  return `M${x + rl} ${y}H${R - rr}A${rr} ${rr} 0 0 1 ${R} ${y + rr}` +
    `L${R - notch} ${y + h / 2}L${R} ${B - rr}A${rr} ${rr} 0 0 1 ${R - rr} ${B}` +
    `H${x + rl}A${rl} ${rl} 0 0 1 ${x} ${B - rl}V${y + rl}A${rl} ${rl} 0 0 1 ${x + rl} ${y}Z`
}

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (parent) parent.appendChild(n)
  return n
}

export function mountIntro(svg) {
  svg.setAttribute("viewBox", "0 0 1920 1080")
  el("rect", { width: 1920, height: 1080, fill: C.ground }, svg)
  const tile = el("rect", { fill: C.ink }, svg)
  const label = el("path", { fill: C.yellow }, svg)
  const glyphs = el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, svg)
  const lock = el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, svg)
  const probe = el("path", { visibility: "hidden" }, svg)

  const lengthOf = (d) => { probe.setAttribute("d", d); return probe.getTotalLength() }
  const sample = (d, n = 72) => {
    probe.setAttribute("d", d)
    const L = probe.getTotalLength()
    return Array.from({ length: n }, (_, i) => { const p = probe.getPointAtLength((L * i) / (n - 1)); return [p.x, p.y] })
  }
  const toD = (pts) => "M" + pts.map((p) => p[0].toFixed(2) + " " + p[1].toFixed(2)).join("L")
  const make = (parent, list) => list.map(([dx, d]) => { const p = el("path", { d }, parent); p._dx = dx; p._len = lengthOf(d); return p })

  const connEls = make(glyphs, WM.conn)
  const textEls = make(glyphs, WM.text)
  const lockLabel = el("rect", { fill: C.yellow }, lock)
  const lockConn = make(lock, WM.conn)
  const lockText = make(lock, WM.text)
  const nWM = sample(WM.conn[2][1])
  const nMark = [sample(MARK.n1), sample(MARK.n2)]

  // 화면 배치
  const S1 = 3, X1 = (1920 - 370 * S1) / 2, Y1 = 540 - 18 * S1
  const K = 440 / 64, IX = 960 - 220, IY = 540 - 220
  const LK = 132, LS = 1.62, GAP = 48
  const LX = (1920 - (LK + GAP + 370 * LS)) / 2
  const LIX = LX, LIY = 540 - LK / 2, LWX = LX + LK + GAP, LWY = 540 - 18 * LS

  const place = (p, sx, sy, s, draw = 1, op = 1) => {
    p.setAttribute("transform", `translate(${sx + s * p._dx} ${sy}) scale(${s})`)
    p.setAttribute("stroke-width", 6.5)
    p.setAttribute("stroke", C.ink)
    p.setAttribute("stroke-dasharray", p._len)
    p.setAttribute("stroke-dashoffset", p._len * (1 - draw))
    p.setAttribute("opacity", op)
  }

  function render(t) {
    const aLab = outC(seg(t, 0.05, 0.55))
    const aConn = (i) => inOut(seg(t, 0.2 + i * 0.08, 0.75 + i * 0.08))
    const aText = (i) => inOut(seg(t, 0.45 + i * 0.07, 1.0 + i * 0.07))
    const out = inOut(seg(t, 1.5, 2.1))        // c, o, text가 빠진다
    const mo = inOut(seg(t, 1.8, 2.8))         // 라벨이 nn만 품고 줄어들며 노치가 생긴다
    const tl = outC(seg(t, 2.55, 3.25))        // 잉크 칸이 펼쳐진다
    const lk = inOut(seg(t, 4.0, 4.75))        // 아이콘이 왼쪽으로
    const lkIn = outC(seg(t, 4.55, 5.15))      // 워드마크가 옆에

    const ik = lerp(K, LK / 64, lk), ix = lerp(IX, LIX, lk), iy = lerp(IY, LIY, lk)
    const toScreen = (x, y) => [ix + ik * x, iy + ik * y]

    const L = WM.label
    const from = { x: X1 + S1 * L.x, y: Y1 + S1 * L.y, w: S1 * L.w * aLab, h: S1 * L.h, rl: S1 * L.r, rr: Math.min(S1 * L.r, (S1 * L.w * aLab) / 2), notch: 0 }
    const [tx, ty] = toScreen(MARK.tag.x, MARK.tag.y)
    const to = { x: tx, y: ty, w: ik * MARK.tag.w, h: ik * MARK.tag.h, rl: ik * MARK.tag.rl, rr: 0, notch: ik * MARK.tag.notch }
    label.setAttribute("d", labelPath(lerpShape(from, to, mo)))
    label.setAttribute("opacity", aLab > 0 ? 1 : 0)

    const T0 = { x: to.x, y: to.y, w: to.w, h: to.h, r: to.rl }
    const T1 = { x: ix, y: iy, w: 64 * ik, h: 64 * ik, r: 14 * ik }
    tile.setAttribute("x", lerp(T0.x, T1.x, tl)); tile.setAttribute("y", lerp(T0.y, T1.y, tl))
    tile.setAttribute("width", lerp(T0.w, T1.w, tl)); tile.setAttribute("height", lerp(T0.h, T1.h, tl))
    tile.setAttribute("rx", lerp(T0.r, T1.r, tl))
    tile.setAttribute("opacity", tl > 0 ? 1 : 0)

    connEls.slice(0, 2).forEach((p, i) => place(p, X1 - 60 * out, Y1, S1, aConn(i), 1 - out))
    textEls.forEach((p, i) => place(p, X1 + 60 * out, Y1, S1, aText(i), 1 - out))

    connEls.slice(2).forEach((p, j) => {
      if (mo <= 0) {
        p.setAttribute("d", WM.conn[2 + j][1])
        place(p, X1, Y1, S1, aConn(2 + j), 1)
        return
      }
      const pts = nWM.map(([x, y], i) => {
        const a = [X1 + S1 * (p._dx + x), Y1 + S1 * y]
        const b = toScreen(...nMark[j][i])
        return [lerp(a[0], b[0], mo), lerp(a[1], b[1], mo)]
      })
      p.setAttribute("d", toD(pts))
      p.removeAttribute("transform")
      p.removeAttribute("stroke-dasharray")
      p.removeAttribute("stroke-dashoffset")
      p.setAttribute("stroke-width", lerp(6.5 * S1, MARK.stroke * ik, mo))
      p.setAttribute("stroke", C.ink)
      p.setAttribute("opacity", 1)
    })

    lock.setAttribute("opacity", lkIn)
    lock.setAttribute("transform", `translate(${(1 - lkIn) * 40} 0)`)
    lockLabel.setAttribute("x", LWX + LS * L.x); lockLabel.setAttribute("y", LWY + LS * L.y)
    lockLabel.setAttribute("width", LS * L.w); lockLabel.setAttribute("height", LS * L.h); lockLabel.setAttribute("rx", LS * L.r)
    lockConn.forEach((p) => place(p, LWX, LWY, LS))
    lockText.forEach((p) => place(p, LWX, LWY, LS))
  }

  return { render, duration: DURATION, settled: SETTLED }
}

// requestAnimationFrame으로 재생한다. onFrame(t)가 false를 돌려주면 멈춘다.
export function play(render, { rate = 1, until = DURATION, onDone } = {}) {
  let t0 = null, stopped = false
  const tick = (now) => {
    if (stopped) return
    if (t0 === null) t0 = now
    const t = Math.min(((now - t0) / 1000) * rate, until)
    render(t)
    if (t < until) requestAnimationFrame(tick)
    else onDone?.()
  }
  requestAnimationFrame(tick)
  return () => { stopped = true }
}
