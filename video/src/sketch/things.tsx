import { useCurrentFrame } from "remotion";
import { C, MONO, SANS } from "../theme";
import { Hand } from "./kit";
import { Rough, ellipse, line, path, poly, rect } from "./rough";

/**
 * 마스코트: 브랜드 마크(A)의 노란 라벨 태그. 마크의 nn 두 아치가 눈이 된다.
 * pose: ask(머리 위 물음표), point(오른팔을 뻗어 가리킴), happy(두 팔 들고 들썩), idle
 */
export const Mascot: React.FC<{ x: number; y: number; size?: number; pose?: "idle" | "ask" | "point" | "happy"; show?: number; flip?: boolean }> =
  ({ x, y, size = 1, pose = "idle", show = 1, flip = false }) => {
    const frame = useCurrentFrame();
    if (show <= 0) return null;
    const bob = pose === "happy" ? Math.abs(Math.sin(frame / 5)) * -14 : Math.sin(frame / 14) * 3;
    const blink = frame % 96 > 90;
    // 몸: mark.svg의 태그 모양(64칸)을 4배로. 원점은 몸 가운데 아래
    const body = "M10.5 14H58L49 32L58 50H10.5A4.5 4.5 0 0 1 6 45.5V18.5A4.5 4.5 0 0 1 10.5 14Z";
    const arm = (side: -1 | 1) => {
      const sx = side < 0 ? 24 : 196, sy = 120;
      if (pose === "happy") return line(sx, sy, sx + side * 46, sy - 64);
      if (pose === "point" && side > 0) return line(sx, sy, sx + 92, sy - 18);
      if (pose === "ask" && side < 0) return line(sx, sy, sx - 30, sy - 58);
      return line(sx, sy, sx + side * 34, sy + 52);
    };
    return (
      <g transform={`translate(${x} ${y + bob}) scale(${size * (0.6 + 0.4 * Math.min(1, show))}) ${flip ? "scale(-1 1)" : ""} translate(-112 -240)`} opacity={Math.min(1, show * 1.5)}>
        {/* 다리 */}
        <Rough shape={line(80, 148, 70, 236)} opt={{ seed: 31, strokeWidth: 5 }} />
        <Rough shape={line(140, 148, 152, 236)} opt={{ seed: 32, strokeWidth: 5 }} />
        <Rough shape={line(52, 238, 76, 238)} opt={{ seed: 33, strokeWidth: 5 }} />
        <Rough shape={line(146, 238, 172, 238)} opt={{ seed: 34, strokeWidth: 5 }} />
        <Rough shape={arm(-1)} opt={{ seed: 35, strokeWidth: 5 }} />
        <Rough shape={arm(1)} opt={{ seed: 36, strokeWidth: 5 }} />
        <g transform="scale(4) translate(-4 -12)">
          <path d={body} fill={C.marker} />
          <Rough shape={path(body)} opt={{ seed: 37, strokeWidth: 0.9, roughness: 0.6 }} />
          {/* 눈: 마크의 nn 아치. 깜박일 때는 납작하게 */}
          <g transform={blink ? "translate(0 36) scale(1 0.25) translate(0 -36)" : undefined}>
            <path d="M14.5 38V32A4 4 0 0 1 22.5 32V38M30.5 38V32A4 4 0 0 1 38.5 32V38" fill="none" stroke={C.brandTile} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <circle cx={11.5} cy={32} r={2.6} fill={C.paper} stroke={C.ink} strokeWidth={0.6} />
          {pose === "happy" && <path d="M22 43 Q26.5 47 31 43" fill="none" stroke={C.brandTile} strokeWidth={2} strokeLinecap="round" />}
        </g>
        {pose === "ask" && <Hand x={150} y={-10} size={110} weight={700} color={C.ink}>?</Hand>}
      </g>
    );
  };

/** 메모지: 살짝 기운 종이에 손글씨, 위에 마스킹테이프 */
export const Slip: React.FC<{ x: number; y: number; w?: number; h?: number; rot?: number; lines: string[]; draw?: number; tape?: boolean; strike?: number; dim?: boolean; seed?: number; tag?: string }> =
  ({ x, y, w = 330, h = 170, rot = -3, lines, draw = 1, tape = true, strike = 0, dim = false, seed = 11, tag }) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} opacity={dim ? 0.55 : 1}>
      <rect x={4} y={6} width={w} height={h} fill="rgba(60,45,20,0.10)" />
      <Rough shape={rect(0, 0, w, h)} opt={{ seed, fill: "#FFFDF6", fillStyle: "solid", strokeWidth: 2.4, roughness: 1.1 }} draw={draw} />
      {lines.map((t, i) => <Hand key={i} x={22} y={60 + i * 52} size={46} write={draw * 1.4 - i * 0.25} color={C.ink}>{t}</Hand>)}
      {tape && <rect x={w / 2 - 50} y={-16} width={100} height={30} fill="rgba(247,210,42,0.7)" transform={`rotate(4 ${w / 2} 0)`} opacity={draw} />}
      {strike > 0 && <Rough shape={line(10, h / 2 - 6, w - 14, h / 2 + 4)} opt={{ seed: seed + 5, stroke: C.red, strokeWidth: 5, roughness: 1.6 }} draw={strike} />}
      {tag && <LabelTag x={w - 150} y={h - 10} w={150} h={50} text={tag} mono />}
    </g>
  );

/** 노란 라벨 태그(브랜드 마크 모양). 손글씨 또는 고정폭 글씨 */
export const LabelTag: React.FC<{ x: number; y: number; w: number; h: number; text: string; write?: number; mono?: boolean; size?: number; fill?: string }> =
  ({ x, y, w, h, text, write = 1, mono = false, size, fill = C.marker }) => {
    const n = h * 0.38;
    const d = `M0 0H${w}L${w - n} ${h / 2}L${w} ${h}H0Z`;
    const show = Math.min(1, write * 3);
    return (
      <g transform={`translate(${x} ${y})`} opacity={show}>
        <path d={d} fill={fill} />
        <Rough shape={path(d)} opt={{ seed: Math.round(w + h), strokeWidth: 2.2, roughness: 0.8 }} />
        <circle cx={h * 0.32} cy={h / 2} r={h * 0.1} fill={C.paper} stroke={C.ink} strokeWidth={1.5} />
        {mono
          ? <text x={h * 0.6} y={h / 2 + (size ?? h * 0.46) * 0.36} fontFamily={MONO} fontSize={size ?? h * 0.46} fontWeight={700} fill={C.ink} opacity={Math.min(1, write * 2)}>{text}</text>
          : <Hand x={h * 0.62} y={h / 2 + (size ?? h * 0.72) * 0.33} size={size ?? h * 0.72} weight={700} write={write * 1.3 - 0.1}>{text}</Hand>}
      </g>
    );
  };

/** 빨간 얼룩(문제 표시) */
export const Splat: React.FC<{ x: number; y: number; r?: number; s?: number; seed?: number }> = ({ x, y, r = 56, s = 1, seed = 5 }) => {
  if (s <= 0) return null;
  const pts: [number, number][] = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2, rr = i % 2 ? r * 0.55 : r * (0.9 + ((i * 37 + seed) % 7) / 20);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  });
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Rough shape={poly(pts)} opt={{ seed, fill: C.red, fillStyle: "solid", stroke: "#a3221c", strokeWidth: 2, roughness: 1.2 }} />
    </g>
  );
};

/** 막대 인물(개발자). pose: think(손을 머리에), hold(종이를 든 팔), idle */
export const Stick: React.FC<{ x: number; y: number; size?: number; pose?: "think" | "hold" | "idle"; draw?: number }> = ({ x, y, size = 1, pose = "idle", draw = 1 }) => {
  const frame = useCurrentFrame();
  const sway = Math.sin(frame / 18) * 2;
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <Rough shape={ellipse(0, -330 + sway, 92, 100)} opt={{ seed: 41, fill: "#FFFDF6", fillStyle: "solid", strokeWidth: 4 }} draw={draw} />
      <circle cx={-14} cy={-332 + sway} r={4.5} fill={C.ink} opacity={draw} />
      <circle cx={16} cy={-332 + sway} r={4.5} fill={C.ink} opacity={draw} />
      <Rough shape={path(`M -12 ${-305 + sway} Q 2 ${-300 + sway} 14 ${-306 + sway}`)} opt={{ seed: 42, strokeWidth: 3 }} draw={draw} />
      <Rough shape={line(0, -280, 4, -120)} opt={{ seed: 43, strokeWidth: 5 }} draw={draw} />
      <Rough shape={line(4, -120, -34, 0)} opt={{ seed: 44, strokeWidth: 5 }} draw={draw} />
      <Rough shape={line(4, -120, 44, 0)} opt={{ seed: 45, strokeWidth: 5 }} draw={draw} />
      <Rough shape={pose === "think" ? path("M 0 -240 L -54 -282 L -30 -330") : line(0, -240, -56, -170)} opt={{ seed: 46, strokeWidth: 5 }} draw={draw} />
      <Rough shape={pose === "hold" ? path("M 0 -240 L 60 -220 L 110 -250") : line(0, -240, 56, -170)} opt={{ seed: 47, strokeWidth: 5 }} draw={draw} />
    </g>
  );
};

/** 터미널 창(시연 세계). lines는 [시작 프레임, 글, 종류] — cmd는 한 글자씩 쳐진다 */
export type TermLine = { at: number; text: string; kind?: "cmd" | "ok" | "out" | "dim" };
export const Terminal: React.FC<{ x: number; y: number; w: number; h: number; title: string; lines: TermLine[]; cps?: number }> = ({ x, y, w, h, title, lines, cps = 1.6 }) => {
  const frame = useCurrentFrame();
  const color = { cmd: C.termFg, ok: C.termOk, out: C.termFg, dim: C.termDim };
  let row = 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 16, background: C.termBg, boxShadow: "0 24px 60px rgba(20,26,38,0.25)", overflow: "hidden" }}>
      <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: "#1C2333" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
        <div style={{ marginLeft: 14, color: C.termDim, fontFamily: SANS, fontSize: 20 }}>{title}</div>
      </div>
      <div style={{ padding: "30px 40px", fontFamily: MONO, fontSize: 36, lineHeight: 1.6 }}>
        {lines.map((l, i) => {
          if (frame < l.at) return null;
          const k = l.kind ?? "out";
          const text = k === "cmd" ? [...l.text].slice(0, Math.floor((frame - l.at) * cps)).join("") : l.text;
          const typing = k === "cmd" && text.length < [...l.text].length;
          row++;
          return (
            <div key={i} style={{ color: color[k], whiteSpace: "pre-wrap", wordBreak: "keep-all" }}>
              {k === "cmd" && <span style={{ color: C.marker }}>&gt; </span>}
              {text}
              {typing && frame % 20 < 12 && <span style={{ background: C.termFg }}>&nbsp;</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
