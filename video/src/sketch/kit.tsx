import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, H, HAND, SANS, W } from "../theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

/** f0~f1 사이를 0→1로(부드럽게). 범위 밖은 0 또는 1 */
export const prog = (frame: number, f0: number, f1: number) => interpolate(frame, [f0, f1], [0, 1], { ...clamp, easing: ease });
/** 튀어나오듯 등장(0→1, 약간 넘쳤다 돌아옴) */
export const usePop = (at: number, damping = 12) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, stiffness: 160 } });
};

/** 스케치북 종이: 크림색 바탕, 잔잔한 결, 위쪽 스프링 */
export const Paper: React.FC<{ rings?: boolean; children?: React.ReactNode }> = ({ rings = true, children }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" /><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0.09 0" /></filter>
      <rect width={W} height={H} filter="url(#grain)" />
      <radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="70%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#6b5a3a" stopOpacity="0.12" /></radialGradient>
      <rect width={W} height={H} fill="url(#vig)" />
    </svg>
    {children}
    {rings && (
      <svg width={W} height={80} style={{ position: "absolute", top: 0, left: 0 }}>
        <rect x={0} y={0} width={W} height={26} fill="#E2D6BC" opacity={0.55} />
        {Array.from({ length: 34 }, (_, i) => {
          const x = 44 + i * 56.5;
          return (
            <g key={i}>
              <ellipse cx={x} cy={50} rx={7} ry={6} fill="#5d5444" opacity={0.55} />
              <path d={`M${x - 2} 50 C ${x - 4} 34, ${x - 2} 6, ${x + 6} 4 C ${x + 13} 2, ${x + 12} 22, ${x + 8} 36`} stroke="#2f3440" strokeWidth={4.5} fill="none" strokeLinecap="round" />
              <path d={`M${x - 1} 46 C ${x - 3} 32, ${x - 1} 10, ${x + 5} 8`} stroke="#9aa0ae" strokeWidth={1.5} fill="none" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    )}
  </AbsoluteFill>
);

/** 밝은 회색 바탕(증거·시연 세계) */
export const Desk: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg,#F1F2F5,#E6E8EC)" }}>{children}</AbsoluteFill>
);

/** 손글씨: write(0→1)에 따라 한 글자씩 써진다 */
export const Hand: React.FC<{ x: number; y: number; size?: number; color?: string; write?: number; weight?: 400 | 700; anchor?: "start" | "middle" | "end"; rotate?: number; children: string }> =
  ({ x, y, size = 44, color = C.ink, write = 1, weight = 400, anchor = "start", rotate = 0, children }) => {
    const n = Math.ceil([...children].length * Math.max(0, Math.min(1, write)));
    if (n <= 0) return null;
    const shown = [...children].slice(0, n).join("");
    const hidden = [...children].slice(n).join("");
    return (
      <text x={x} y={y} fontFamily={HAND} fontSize={size} fontWeight={weight} fill={color} textAnchor={anchor} letterSpacing={-size * 0.06}
        transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>
        {shown}<tspan fill="transparent">{hidden}</tspan>
      </text>
    );
  };

/** 카메라: 장면(1920×1080 좌표)을 keys에 따라 옮기고 확대한다. x,y는 화면 가운데에 올 점 */
export type Cam = { f: number; x: number; y: number; s: number };
export const Camera: React.FC<{ keys: Cam[]; children: React.ReactNode }> = ({ keys, children }) => {
  const frame = useCurrentFrame();
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i++) if (keys[i].f <= frame) { a = keys[i]; b = keys[Math.min(i + 1, keys.length - 1)]; }
  const t = b.f === a.f ? 1 : prog(frame, a.f, b.f);
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, s = a.s + (b.s - a.s) * t;
  return (
    <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${W / 2}px, ${H / 2}px) scale(${s}) translate(${-x}px, ${-y}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/** 카메라 이동 구간: f부터 len 프레임 동안 a에서 b로 */
export const move = (f: number, len: number, a: Omit<Cam, "f">, b: Omit<Cam, "f">): Cam[] => [{ f, ...a }, { f: f + len, ...b }];

/** 아래 자막. **핵심어**는 브랜드 노랑으로 */
export const Caption: React.FC<{ text: string; opacity?: number }> = ({ text, opacity = 1 }) => {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity }}>
      <div style={{ background: "rgba(22,26,36,0.82)", color: "#fff", fontFamily: SANS, fontSize: 40, fontWeight: 600, padding: "10px 24px", borderRadius: 8, letterSpacing: -0.5, maxWidth: 1500, textAlign: "center", lineHeight: 1.35 }}>
        {parts.map((p, i) => (i % 2 ? <span key={i} style={{ color: C.marker }}>{p}</span> : <span key={i}>{p}</span>))}
      </div>
    </div>
  );
};

/** 오른쪽 위 장 표시(마스킹테이프 위 손글씨) */
export const Chapter: React.FC<{ no: number; total: number; label: string }> = ({ no, total, label }) => (
  <div style={{ position: "absolute", top: 86, right: 64, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
    <div style={{ background: "rgba(247,210,42,0.85)", transform: "rotate(1.5deg)", padding: "4px 22px 2px", fontFamily: HAND, fontWeight: 700, fontSize: 46, color: C.ink, boxShadow: "0 1px 0 rgba(0,0,0,0.08)" }}>{label}</div>
    <div style={{ display: "flex", gap: 6 }}>
      {Array.from({ length: total }, (_, i) => <div key={i} style={{ width: i + 1 === no ? 26 : 10, height: 6, borderRadius: 3, background: i + 1 <= no ? C.ink : "rgba(30,36,51,0.2)" }} />)}
    </div>
  </div>
);
