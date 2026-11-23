import { useMemo } from "react";
import rough from "roughjs";
import { C } from "../theme";

const gen = rough.generator();

export type RoughOpt = {
  seed?: number; roughness?: number; bowing?: number; stroke?: string; strokeWidth?: number;
  fill?: string; fillStyle?: "solid" | "hachure" | "zigzag" | "cross-hatch"; hachureGap?: number; fillWeight?: number;
};
type Shape =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number }
  | { k: "ellipse"; cx: number; cy: number; w: number; h: number }
  | { k: "path"; d: string }
  | { k: "poly"; pts: [number, number][] };

const draw = (s: Shape, o: RoughOpt) => {
  const opt = { seed: 7, roughness: 1.4, bowing: 1, stroke: C.ink, strokeWidth: 3, ...o };
  switch (s.k) {
    case "rect": return gen.rectangle(s.x, s.y, s.w, s.h, opt);
    case "line": return gen.line(s.x1, s.y1, s.x2, s.y2, opt);
    case "ellipse": return gen.ellipse(s.cx, s.cy, s.w, s.h, opt);
    case "path": return gen.path(s.d, opt);
    case "poly": return gen.polygon(s.pts, opt);
  }
};

/**
 * 손그림 도형. draw(0→1)로 선이 그려지고, 칠은 선을 따라 나타난다.
 * 같은 seed면 프레임마다 같은 모양이라 떨리지 않는다.
 */
export const Rough: React.FC<{ shape: Shape; opt?: RoughOpt; draw?: number; fillDraw?: number; dash?: string }> = ({ shape, opt = {}, draw: p = 1, fillDraw, dash }) => {
  const key = JSON.stringify([shape, opt]);
  const paths = useMemo(() => gen.toPaths(draw(shape, opt)), [key]);
  const fp = fillDraw ?? p;
  if (p <= 0 && fp <= 0) return null;
  return (
    <g>
      {paths.map((ph, i) => {
        const isFill = ph.fill && ph.fill !== "none";
        const isHachure = !isFill && ph.stroke !== (opt.stroke ?? C.ink);
        if (isFill) return <path key={i} d={ph.d} fill={ph.fill} stroke="none" opacity={Math.min(1, fp * 1.5)} />;
        const prog = isHachure ? fp : p;
        if (dash) return <path key={i} d={ph.d} fill="none" stroke={ph.stroke} strokeWidth={ph.strokeWidth} strokeLinecap="round" strokeDasharray={dash} opacity={Math.min(1, prog * 2)} />;
        return (
          <path key={i} d={ph.d} fill="none" stroke={ph.stroke} strokeWidth={ph.strokeWidth} strokeLinecap="round" strokeLinejoin="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, Math.min(1, prog))} />
        );
      })}
    </g>
  );
};

export const rect = (x: number, y: number, w: number, h: number): Shape => ({ k: "rect", x, y, w, h });
export const line = (x1: number, y1: number, x2: number, y2: number): Shape => ({ k: "line", x1, y1, x2, y2 });
export const ellipse = (cx: number, cy: number, w: number, h: number): Shape => ({ k: "ellipse", cx, cy, w, h });
export const path = (d: string): Shape => ({ k: "path", d });
export const poly = (pts: [number, number][]): Shape => ({ k: "poly", pts });
