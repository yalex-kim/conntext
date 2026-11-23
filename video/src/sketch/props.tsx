import { useCurrentFrame } from "remotion";
import { C, HAND, MONO } from "../theme";
import { Hand } from "./kit";
import { Rough, ellipse, line, path, poly, rect } from "./rough";
import { LabelTag } from "./things";

/** AI 로봇(에이전트). 원점은 발 가운데. name은 목에 건 이름표 */
export const Robot: React.FC<{ x: number; y: number; size?: number; name?: string; face?: "ok" | "blank" | "q" | "happy"; arms?: "down" | "hold" | "up" | "reach"; draw?: number; tint?: string; run?: boolean }> =
  ({ x, y, size = 1, name, face = "ok", arms = "down", draw = 1, tint = "#DCE4F1", run = false }) => {
    const frame = useCurrentFrame();
    const step = run ? Math.sin(frame / 3) : 0;
    const bob = run ? Math.abs(step) * -8 : Math.sin(frame / 16) * 2;
    const arm = (side: -1 | 1) => {
      const sx = side < 0 ? -78 : 78, sy = -190;
      if (arms === "up") return line(sx, sy, sx + side * 40, sy - 70);
      if (arms === "hold") return path(`M ${sx} ${sy} L ${sx + side * 28} ${sy + 40} L ${side * 30} ${sy + 52}`);
      if (arms === "reach" && side > 0) return line(sx, sy, sx + 110, sy - 10);
      return line(sx, sy, sx + side * 26 + (run ? step * 20 * side : 0), sy + 78);
    };
    return (
      <g transform={`translate(${x} ${y + bob}) scale(${size})`}>
        <Rough shape={line(-34, -110, -40 + step * 22, 0)} opt={{ seed: 201, strokeWidth: 5 }} draw={draw} />
        <Rough shape={line(34, -110, 40 - step * 22, 0)} opt={{ seed: 202, strokeWidth: 5 }} draw={draw} />
        <Rough shape={rect(-78, -240, 156, 135)} opt={{ seed: 203, fill: tint, fillStyle: "solid", strokeWidth: 4 }} draw={draw} />
        <Rough shape={arm(-1)} opt={{ seed: 204, strokeWidth: 5 }} draw={draw} />
        <Rough shape={arm(1)} opt={{ seed: 205, strokeWidth: 5 }} draw={draw} />
        <Rough shape={rect(-62, -360, 124, 100)} opt={{ seed: 206, fill: tint, fillStyle: "solid", strokeWidth: 4 }} draw={draw} />
        <Rough shape={rect(-46, -344, 92, 64)} opt={{ seed: 207, fill: "#27314A", fillStyle: "solid", strokeWidth: 3 }} draw={draw} />
        <Rough shape={line(0, -360, 0, -392)} opt={{ seed: 208, strokeWidth: 4 }} draw={draw} />
        <circle cx={0} cy={-398} r={8} fill={C.red} opacity={draw} />
        {draw > 0.6 && face === "ok" && <><rect x={-26} y={-326} width={12} height={20} rx={5} fill="#9FE3FF" /><rect x={14} y={-326} width={12} height={20} rx={5} fill="#9FE3FF" /></>}
        {draw > 0.6 && face === "happy" && <path d="M -28 -308 Q -20 -322 -12 -308 M 12 -308 Q 20 -322 28 -308" stroke="#9FE3FF" strokeWidth={5} fill="none" strokeLinecap="round" />}
        {draw > 0.6 && face === "blank" && <path d="M -28 -312 H -10 M 10 -312 H 28" stroke="#9FE3FF" strokeWidth={5} strokeLinecap="round" />}
        {draw > 0.6 && face === "q" && <text x={0} y={-296} textAnchor="middle" fontFamily={HAND} fontWeight={700} fontSize={56} fill="#9FE3FF">?</text>}
        <text x={0} y={-160} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={34} fill={C.ink} opacity={draw}>AI</text>
        {name && <LabelTag x={-96} y={-104} w={192} h={44} text={name} write={draw} size={26} mono />}
      </g>
    );
  };

/** 가방. 원점은 바닥 가운데. 내용물은 바깥에서 그린다 */
export const Bag: React.FC<{ x: number; y: number; size?: number; draw?: number; label?: string }> = ({ x, y, size = 1, draw = 1, label }) => (
  <g transform={`translate(${x} ${y}) scale(${size})`}>
    <Rough shape={path("M -70 -200 C -70 -260, 70 -260, 70 -200")} opt={{ seed: 301, strokeWidth: 6 }} draw={draw} />
    <Rough shape={path("M -130 -200 H 130 L 118 0 H -118 Z")} opt={{ seed: 302, fill: "#C9874B", fillStyle: "hachure", hachureGap: 12, strokeWidth: 4 }} draw={draw} />
    <Rough shape={rect(-70, -130, 140, 70)} opt={{ seed: 303, strokeWidth: 3 }} draw={draw} />
    {label && <Hand x={0} y={-80} size={40} weight={700} anchor="middle" write={draw}>{label}</Hand>}
  </g>
);

/** 예산 눈금: 반원 계기판, value(0~1)에 따라 바늘. 0.8 넘으면 빨간 구간 */
export const Gauge: React.FC<{ x: number; y: number; value: number; size?: number; draw?: number; label?: string }> = ({ x, y, value, size = 1, draw = 1, label = "예산" }) => {
  const a = Math.PI * (1 - Math.max(0, Math.min(1, value)));
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} opacity={Math.min(1, draw * 2)}>
      <path d="M -110 0 A 110 110 0 0 1 110 0" fill="none" stroke="#DCD3BE" strokeWidth={22} />
      <path d={`M ${110 * Math.cos(Math.PI * 0.2)} ${-110 * Math.sin(Math.PI * 0.2)} A 110 110 0 0 1 110 0`} fill="none" stroke="#F2B5AE" strokeWidth={22} />
      <Rough shape={path("M -130 0 A 130 130 0 0 1 130 0 Z")} opt={{ seed: 311, strokeWidth: 3 }} draw={draw} />
      <line x1={0} y1={0} x2={92 * Math.cos(a)} y2={-92 * Math.sin(a)} stroke={C.ink} strokeWidth={6} strokeLinecap="round" />
      <circle r={10} fill={C.ink} />
      <Hand x={0} y={54} size={42} weight={700} anchor="middle" write={draw}>{label}</Hand>
    </g>
  );
};

/** 사물함: cols×rows 칸, 칸마다 번호표 */
export const Lockers: React.FC<{ x: number; y: number; cols?: number; rows?: number; cell?: number; nums: string[]; draw?: number; open?: number }> =
  ({ x, y, cols = 3, rows = 2, cell = 130, nums, draw = 1, open = -1 }) => (
    <g transform={`translate(${x} ${y})`}>
      <Rough shape={rect(0, 0, cols * cell + 20, rows * cell + 20)} opt={{ seed: 321, fill: "#B9C7DD", fillStyle: "hachure", hachureGap: 12, strokeWidth: 4 }} draw={draw} />
      {Array.from({ length: cols * rows }, (_, i) => {
        const cx = 10 + (i % cols) * cell, cy = 10 + Math.floor(i / cols) * cell;
        return (
          <g key={i}>
            <Rough shape={rect(cx + 6, cy + 6, cell - 12, cell - 12)} opt={{ seed: 330 + i, fill: i === open ? C.markerSoft : "#EEF1F6", fillStyle: "solid", strokeWidth: 2.5 }} draw={draw} />
            <text x={cx + cell / 2} y={cy + 52} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={30} fill={C.ink} opacity={draw}>{nums[i]}</text>
            <Rough shape={line(cx + cell / 2 - 20, cy + 84, cx + cell / 2 + 20, cy + 84)} opt={{ seed: 340 + i, strokeWidth: 3 }} draw={draw} />
          </g>
        );
      })}
    </g>
  );

/** 두꺼운 책(본문) */
export const Book: React.FC<{ x: number; y: number; s?: number; title?: string }> = ({ x, y, s = 1, title = "본문" }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <Rough shape={rect(-60, -80, 120, 160)} opt={{ seed: 351, fill: "#7FA0D6", fillStyle: "solid", strokeWidth: 3 }} />
    <Rough shape={line(-44, -80, -44, 80)} opt={{ seed: 352, strokeWidth: 3 }} />
    <Hand x={8} y={10} size={38} weight={700} anchor="middle" color="#fff">{title}</Hand>
  </g>
);

/** 번호표 */
export const Ticket: React.FC<{ x: number; y: number; s?: number; text: string; rot?: number }> = ({ x, y, s = 1, text, rot = -6 }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <LabelTag x={-60} y={-24} w={130} h={48} text={text} mono />
  </g>
);

/** 카드 상자: 탭에 '언제 쓰는지'만 보인다 */
export const CardBox: React.FC<{ x: number; y: number; tabs: string[]; draw?: number; lift?: number; pick?: number }> = ({ x, y, tabs, draw = 1, lift = 0, pick = 0 }) => (
  <g transform={`translate(${x} ${y})`}>
    {tabs.map((t, i) => {
      const up = i === pick ? lift * -150 : 0;
      return (
        <g key={i} transform={`translate(0 ${up})`}>
          <Rough shape={rect(40 + i * 22, -170 + i * 46, 620, 220)} opt={{ seed: 361 + i, fill: i === pick && lift > 0 ? "#FFF6CC" : "#FFFDF6", fillStyle: "solid", strokeWidth: 2.5 }} draw={draw} />
          <Rough shape={rect(60 + i * 22 + i * 40, -214 + i * 46, 400, 52)} opt={{ seed: 371 + i, fill: i === pick && lift > 0 ? C.marker : "#F3E6C4", fillStyle: "solid", strokeWidth: 2.5 }} draw={draw} />
          <Hand x={78 + i * 62} y={-176 + i * 46} size={36} weight={700} write={draw}>{t}</Hand>
        </g>
      );
    })}
    <Rough shape={path("M 0 -40 H 720 V 200 H 0 Z")} opt={{ seed: 381, fill: "#D7B98A", fillStyle: "hachure", hachureGap: 12, strokeWidth: 4 }} draw={draw} />
    <LabelTag x={250} y={60} w={220} h={70} text="절차" write={draw} />
  </g>
);

/** 깃발(이어달리기 체크포인트) */
export const Flag: React.FC<{ x: number; y: number; text?: string; draw?: number; color?: string }> = ({ x, y, text, draw = 1, color = C.marker }) => (
  <g transform={`translate(${x} ${y})`}>
    <Rough shape={line(0, 0, 0, -120)} opt={{ seed: Math.round(x) % 97 + 400, strokeWidth: 4 }} draw={draw} />
    <path d="M 0 -120 L 70 -100 L 0 -80 Z" fill={color} opacity={draw} />
    <Rough shape={path("M 0 -120 L 70 -100 L 0 -80 Z")} opt={{ seed: Math.round(x) % 89 + 410, strokeWidth: 2.5 }} draw={draw} />
    {text && <Hand x={0} y={-136} size={34} weight={700} anchor="middle" write={draw}>{text}</Hand>}
  </g>
);

/** 코르크 게시판 */
export const Board: React.FC<{ x: number; y: number; w: number; h: number; title?: string; draw?: number }> = ({ x, y, w, h, title, draw = 1 }) => (
  <g transform={`translate(${x} ${y})`}>
    <Rough shape={rect(0, 0, w, h)} opt={{ seed: 421, fill: "#D9A86C", fillStyle: "cross-hatch", hachureGap: 16, strokeWidth: 6, stroke: "#7A4E25" }} draw={draw} />
    {title && <LabelTag x={30} y={-34} w={Math.max(240, title.length * 34)} h={64} text={title} write={draw} />}
  </g>
);

export const Pin: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => s > 0 ? (
  <g transform={`translate(${x} ${y}) scale(${s})`}><circle r={14} fill={C.red} stroke="#8a1f19" strokeWidth={2} /><circle cx={-4} cy={-4} r={4} fill="#fff" opacity={0.6} /></g>
) : null;

/** 종(알림) */
export const Bell: React.FC<{ x: number; y: number; ring?: number }> = ({ x, y, ring = 0 }) => {
  const frame = useCurrentFrame();
  const r = ring > 0 ? Math.sin(frame / 2) * 14 * ring : 0;
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <Rough shape={path("M -40 30 C -40 -40, 40 -40, 40 30 L 52 44 H -52 Z")} opt={{ seed: 431, fill: C.marker, fillStyle: "solid", strokeWidth: 3.5 }} />
      <circle cy={52} r={10} fill={C.ink} />
      {ring > 0 && <><Rough shape={path("M -70 -20 Q -86 10 -70 40")} opt={{ seed: 432, strokeWidth: 3 }} /><Rough shape={path("M 70 -20 Q 86 10 70 40")} opt={{ seed: 433, strokeWidth: 3 }} /></>}
    </g>
  );
};

/** 해 낙서 */
export const Sun: React.FC<{ x: number; y: number; draw?: number }> = ({ x, y, draw = 1 }) => (
  <g transform={`translate(${x} ${y})`}>
    <Rough shape={ellipse(0, 0, 90, 90)} opt={{ seed: 441, fill: C.marker, fillStyle: "hachure", hachureGap: 8, strokeWidth: 3.5 }} draw={draw} />
    {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <Rough key={i} shape={line(Math.cos(a) * 62, Math.sin(a) * 62, Math.cos(a) * 92, Math.sin(a) * 92)} opt={{ seed: 450 + i, strokeWidth: 3.5 }} draw={draw} />; })}
  </g>
);

/** 말풍선 */
export const Bubble: React.FC<{ x: number; y: number; w: number; h: number; text: string; tail?: [number, number]; write?: number; size?: number }> = ({ x, y, w, h, text, tail = [40, 40], write = 1, size = 40 }) => (
  <g transform={`translate(${x} ${y})`} opacity={Math.min(1, write * 3)}>
    <Rough shape={path(`M 0 0 H ${w} V ${h} H ${tail[0] + 40} L ${tail[0]} ${h + tail[1]} L ${tail[0] + 10} ${h} H 0 Z`)} opt={{ seed: Math.round(w + h) + 460, fill: "#FFFFFF", fillStyle: "solid", strokeWidth: 3 }} />
    <Hand x={w / 2} y={h / 2 + size * 0.34} size={size} weight={700} anchor="middle" write={write * 1.3}>{text}</Hand>
  </g>
);

/** 체크 표시 */
export const Check: React.FC<{ x: number; y: number; draw?: number; s?: number; color?: string }> = ({ x, y, draw = 1, s = 1, color = C.state }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}><Rough shape={path("M -22 0 L -6 18 L 26 -22")} opt={{ seed: 471, stroke: color, strokeWidth: 7, roughness: 0.8 }} draw={draw} /></g>
);

/** 유리 상자(예외 열람) */
export const GlassBox: React.FC<{ x: number; y: number; crack?: number; draw?: number }> = ({ x, y, crack = 0, draw = 1 }) => (
  <g transform={`translate(${x} ${y})`}>
    <Rough shape={rect(-110, -150, 220, 150)} opt={{ seed: 481, fill: "#E3F1F6", fillStyle: "solid", strokeWidth: 4 }} draw={draw} />
    <Hand x={0} y={-60} size={38} weight={700} anchor="middle" color={C.red} write={draw}>예외 열람</Hand>
    <Rough shape={poly([[-20, -150], [6, -110], [-12, -86], [18, -50]])} opt={{ seed: 482, strokeWidth: 3, stroke: C.ink2 }} draw={crack} />
    <Rough shape={line(6, -110, 50, -128)} opt={{ seed: 483, strokeWidth: 3, stroke: C.ink2 }} draw={crack} />
  </g>
);
