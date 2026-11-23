import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, H, HAND, SANS, W } from "../theme";
import { Camera, Caption, Chapter, Desk, Hand, Paper, clamp, prog, usePop, type Cam } from "../sketch/kit";
import { Rough, ellipse, line, path, rect } from "../sketch/rough";
import { LabelTag, Mascot, Slip, Splat, Stick, Terminal } from "../sketch/things";
import { Bag, Bell, Board, Book, Bubble, CardBox, Check, Flag, GlassBox, Gauge, Lockers, Pin, Robot, Sun, Ticket } from "../sketch/props";
import type { Timed } from "./timing";

export type SceneProps = { sc: Timed };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const at = (c: number[], i: number, frac = 0) => Math.round(c[i] + ((c[i + 1] ?? c[i] + 90) - c[i]) * frac);

/** 장면의 자막과 장 표시 */
export const Overlay: React.FC<SceneProps> = ({ sc }) => {
  const frame = useCurrentFrame();
  let i = -1;
  sc.cues.forEach((c, k) => { if (frame >= c) i = k; });
  return (
    <>
      {sc.chapter && <Chapter no={sc.chapter[0]} total={6} label={sc.chapter[1]} />}
      {i >= 0 && <Caption text={sc.lines[i].caption} opacity={interpolate(frame - sc.cues[i], [0, 5], [0, 1], clamp)} />}
    </>
  );
};

const Floor: React.FC<{ draw?: number; y?: number; x0?: number; x1?: number }> = ({ draw = 1, y = 905, x0 = 60, x1 = 1860 }) =>
  <Rough shape={line(x0, y, x1, y - 4)} opt={{ seed: 9, strokeWidth: 2.5, stroke: C.ink2 }} draw={draw} />;

const Svg: React.FC<{ children: React.ReactNode }> = ({ children }) => <svg width={W} height={H} style={{ overflow: "visible", position: "absolute", inset: 0 }}>{children}</svg>;

const SLIPS: string[][] = [["테스트는", "make test-hw-sim"], ["broker 먼저", "재시작"], ["스테이징 배포", "목요일 오전만"]];

/* ── S1 훅: 같은 설명의 반복, 세션이 끝나면 날아가는 메모 ─────────────────── */
export const Hook: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const give = [c[0] + 12, c[0] + 34, c[0] + 56];
  const target = [[880, 250], [1180, 190], [1480, 260]];
  const wind = c[2] + 6;
  const blown = f >= wind;
  const splat = usePop(c[2] + 62, 9);
  return (
    <Paper>
      <Camera keys={[{ f: 0, x: 960, y: 560, s: 1.0 }, { f: sc.frames, x: 1000, y: 520, s: 1.07 }]}>
        <Svg>
          <Floor draw={prog(f, 0, 16)} />
          <Stick x={470} y={900} pose={f > c[2] + 50 ? "think" : "hold"} draw={prog(f, 0, 18)} />
          <Robot x={1250} y={900} face={f > c[2] + 40 ? "q" : f > wind ? "blank" : "ok"} draw={prog(f, 4, 26)} />
          {SLIPS.map((l, i) => {
            const t = prog(f, give[i], give[i] + 22);
            if (t <= 0) return null;
            let x = lerp(590, target[i][0], t), y = lerp(650, target[i][1], t) - Math.sin(t * Math.PI) * 120;
            let r = lerp(-8, [-6, 4, -3][i], t);
            const hl = [c[1], at(c, 1, 0.5), -1][i];
            const pulse = hl > 0 ? interpolate(f, [hl, hl + 6, hl + 18], [1, 1.12, 1], clamp) : 1;
            if (blown) {
              const b = prog(f, wind + i * 5, wind + 34 + i * 5);
              x += b * (900 + i * 120); y += b * (-160 + i * 60) + Math.sin(b * 7 + i) * 30; r += b * (220 + i * 60);
            }
            return <g key={i} transform={`translate(${x} ${y}) scale(${0.78 * pulse})`}><Slip x={0} y={0} w={400} rot={r} lines={l} seed={21 + i} /></g>;
          })}
          {blown && [0, 1, 2, 3].map((i) => (
            <Rough key={i} shape={path(`M ${-60 + i * 30} ${280 + i * 120} C ${400} ${200 + i * 140}, ${900} ${360 + i * 110}, ${1900} ${240 + i * 150}`)}
              opt={{ seed: 61 + i, strokeWidth: 3, stroke: C.ink3 }} draw={prog(f, wind - 4 + i * 3, wind + 22 + i * 3) - prog(f, wind + 30, wind + 52)} />
          ))}
          <Splat x={1420} y={470} r={58} s={splat} />
          {splat > 0.3 && <Hand x={1490} y={480} size={44} weight={700} color={C.red} write={prog(f, c[2] + 66, c[2] + 80)}>pytest ✗</Hand>}
        </Svg>
      </Camera>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S2 브랜드: 날아오던 메모에 라벨이 붙어 멈추고, conntext ─────────────── */
export const Brand: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const word = usePop(c[0] + 16, 14);
  const mascot = usePop(c[1] - 4, 10);
  const stops = [[300, 250, -10], [1600, 230, 8], [1560, 640, -6]];
  return (
    <Paper>
      <Svg>
        {SLIPS.map((l, i) => {
          const t = prog(f, 0 + i * 4, 22 + i * 4);
          const x = lerp(-500, stops[i][0], t), y = stops[i][1] + Math.sin((1 - t) * 6 + i) * 40 * (1 - t);
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(0.62)`}>
              <Slip x={0} y={0} w={400} rot={stops[i][2] + (1 - t) * 160} lines={l} seed={21 + i} />
              <g transform={`rotate(${stops[i][2]})`}><LabelTag x={250} y={-50} w={170} h={64} text="m:1" mono write={prog(f, 22 + i * 6, 34 + i * 6)} /></g>
            </g>
          );
        })}
      </Svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 380, display: "flex", justifyContent: "center", alignItems: "center", gap: 22, transform: `scale(${0.7 + 0.3 * word})`, opacity: Math.min(1, word * 1.5) }}>
        <div style={{ position: "relative", background: C.marker, padding: "10px 70px 18px 44px", clipPath: "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)", fontFamily: SANS, fontWeight: 800, fontSize: 150, color: C.brandTile, letterSpacing: -4, lineHeight: 1 }}>conn</div>
        <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 150, color: C.ink, letterSpacing: -4, lineHeight: 1 }}>text</div>
      </div>
      <Svg>
        <Mascot x={960} y={900} size={0.85} pose="happy" show={mascot} />
        <Hand x={960} y={660} size={56} weight={700} anchor="middle" write={prog(f, c[1] + 4, c[1] + 40)}>적어 둔 맥락 → 다음 세션</Hand>
      </Svg>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S3 적기: /remember → 네 칸 서랍 → 옛 메모는 이력으로 ─────────────────── */
const CAB = { x: 760, y: 240, w: 420, h: 640 };
const DRAWERS = ["지시·선호", "지식", "절차", "진행 상태"];
const dy = (i: number) => CAB.y + 26 + i * 152;
const BUB = { x: 1240, y: 300, w: 560, h: 420 };
const BINDER = { x: 1530, y: 790 };

/** 서랍장(작은 판은 정리 장면에서도 쓴다) */
export const Cabinet: React.FC<{ draw?: number; labels?: number[]; glow?: number; k?: number }> = ({ draw = 1, labels = [1, 1, 1, 1], glow = 0, k = 1 }) => (
  <g>
    <Rough shape={rect(CAB.x, CAB.y, CAB.w, CAB.h)} opt={{ seed: 50, fill: "#E9D7B4", fillStyle: "hachure", hachureGap: 14, strokeWidth: 4 }} draw={draw} />
    {DRAWERS.map((name, i) => (
      <g key={name}>
        {i === k && <rect x={CAB.x + 22} y={dy(i)} width={CAB.w - 44} height={132} fill={C.markerSoft} opacity={glow} />}
        <Rough shape={rect(CAB.x + 22, dy(i), CAB.w - 44, 132)} opt={{ seed: 60 + i, fill: "#FBF4E4", fillStyle: "solid", strokeWidth: 3 }} draw={Math.min(1, draw * 1.2 - i * 0.05)} fillDraw={glow > 0 && i === k ? 0 : undefined} />
        <Rough shape={rect(CAB.x + 300, dy(i) + 84, 70, 22)} opt={{ seed: 70 + i, strokeWidth: 3 }} draw={draw} />
        <LabelTag x={CAB.x + 40} y={dy(i) + 18} w={268} h={64} text={name} write={labels[i]} />
      </g>
    ))}
  </g>
);

export const Remember: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const splat = usePop(c[3] + 44, 9);
  const m = usePop(c[1] + 6);
  if (f < c[1]) {
    return (
      <Desk>
        <Terminal x={160} y={300} w={1600} h={360} title="Claude Code · ble-gateway" cps={1.9} lines={[
          { at: 4, kind: "cmd", text: "/conntext:remember 스테이징 배포는 목요일 오전만 가능하도록 변경됨. 화요일은 QA 회귀 테스트와 겹친다" },
          { at: Math.max(48, c[1] - 30), kind: "ok", text: "저장됨 m:12 → [스테이징 배포] · 지식 · 범위: 저장소 ble-gateway" },
          { at: Math.max(54, c[1] - 22), kind: "dim", text: "이전 메모 1건 대체: \"스테이징 배포는 화요일 오전만 가능\" (10/25)" },
        ]} />
        <Overlay sc={sc} />
      </Desk>
    );
  }
  const C1 = c[1];
  const cab = prog(f, C1 + 8, C1 + 44);
  const labelAt = [0.6, 0.74, 0.82, 0.9].map((fr) => at(c, 1, fr));
  const k = 1;
  const toSide = prog(f, c[2] + 4, c[2] + 30);
  const inDrawer = prog(f, c[2] + 34, c[2] + 56);
  const glow = interpolate(f, [c[2] + 30, c[2] + 46, c[3] - 10, c[3] + 10], [0, 1, 1, 0.35], clamp);
  const bubble = prog(f, c[3] + 2, c[3] + 26);
  const oldUp = prog(f, c[3] + 18, c[3] + 36);
  const strike = prog(f, c[4] + 4, c[4] + 24);
  const binder = prog(f, c[4] + 14, c[4] + 34);
  const toBinder = prog(f, c[4] + 30, c[4] + 60);
  const newIn = prog(f, c[4] + 60, c[4] + 82);
  const happy = f >= c[4] + 80;

  const sx0 = 150, sy0 = 300, sx1 = 1230, sy1 = dy(k) - 10, sx2 = 980, sy2 = dy(k) + 60;
  let nx = lerp(sx0, sx1, toSide), ny = lerp(sy0, sy1, toSide) - Math.sin(toSide * Math.PI) * 120;
  let nsc = 1 - 0.35 * toSide;
  nx = lerp(nx, sx2, inDrawer); ny = lerp(ny, sy2, inDrawer); nsc *= 1 - 0.9 * inDrawer;
  const oldPos = { x: BUB.x + 60, y: BUB.y + 70 }, newPos = { x: BUB.x + 150, y: BUB.y + 220 };
  const ox = lerp(oldPos.x, BINDER.x + 10, toBinder), oy = lerp(oldPos.y, BINDER.y + 20, toBinder), osc = 1 - 0.55 * toBinder;
  const npx = lerp(newPos.x, oldPos.x, newIn), npy = lerp(newPos.y, oldPos.y, newIn);
  const cams: Cam[] = [
    { f: C1, x: 420, y: 470, s: 1.45 }, { f: C1 + 14, x: 420, y: 470, s: 1.45 }, { f: C1 + 54, x: 960, y: 560, s: 1.0 },
    { f: c[3], x: 960, y: 560, s: 1.0 }, { f: c[3] + 24, x: 1400, y: 560, s: 1.32 },
    { f: c[4] + 66, x: 1400, y: 560, s: 1.32 }, { f: c[4] + 100, x: 1010, y: 560, s: 0.97 },
  ];
  return (
    <Paper>
      <Camera keys={cams}>
        <Svg>
          <Floor draw={cab} />
          <Cabinet draw={cab} labels={labelAt.map((t) => prog(f, t, t + 14))} glow={glow} k={k} />
          <Mascot x={560} y={895} size={0.8} pose={happy ? "happy" : "point"} show={m} />
          {bubble > 0 && (
            <g>
              <Rough shape={line(CAB.x + CAB.w - 20, dy(k) + 10, BUB.x, BUB.y)} opt={{ seed: 81, strokeWidth: 2, stroke: C.ink2 }} draw={bubble} />
              <Rough shape={line(CAB.x + CAB.w - 20, dy(k) + 120, BUB.x, BUB.y + BUB.h)} opt={{ seed: 82, strokeWidth: 2, stroke: C.ink2 }} draw={bubble} />
              <Rough shape={rect(BUB.x, BUB.y, BUB.w, BUB.h)} opt={{ seed: 83, fill: "#FFFBEF", fillStyle: "solid", strokeWidth: 3.5 }} draw={bubble} />
              <Hand x={BUB.x + 20} y={BUB.y - 16} size={42} weight={700} write={bubble}>지식 서랍 속</Hand>
            </g>
          )}
          {binder > 0 && (
            <g>
              <Rough shape={rect(BINDER.x - 30, BINDER.y - 20, 300, 130)} opt={{ seed: 95, fill: "#D9E2F2", fillStyle: "hachure", hachureGap: 10, strokeWidth: 3 }} draw={binder} />
              <LabelTag x={BINDER.x - 10} y={BINDER.y - 74} w={160} h={60} text="이력" write={binder} />
            </g>
          )}
          {oldUp > 0 && (
            <g transform={`translate(${ox} ${oy}) scale(${osc})`} opacity={oldUp}>
              <Slip x={0} y={0} w={330} h={140} rot={3} lines={["스테이징 배포는", "화요일 오전만"]} strike={strike} seed={91} tape={false} dim={toBinder > 0.6} />
            </g>
          )}
          <Splat x={BUB.x + 400} y={BUB.y + 190} r={60} s={(1 - strike) * splat} />
          {inDrawer < 1 && (
            <g transform={`translate(${nx} ${ny}) scale(${nsc})`}>
              <Slip x={0} y={0} w={360} h={150} rot={-3} lines={["스테이징 배포는", "목요일 오전만"]} seed={12} />
            </g>
          )}
          {bubble > 0 && (
            <g transform={`translate(${npx} ${npy})`} opacity={prog(f, c[3] + 26, c[3] + 40)}>
              <Slip x={0} y={0} w={330} h={140} rot={-2} lines={["스테이징 배포는", "목요일 오전만"]} seed={13} tag={newIn >= 1 ? "m:12" : undefined} />
            </g>
          )}
        </Svg>
      </Camera>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S4 세션 시작: 가방 챙기기, 사물함과 번호표, 질문마다 한 장 더 ─────────── */
export const Inject: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const walk = prog(f, 4, 40);
  const bag = prog(f, c[1] + 4, c[1] + 26);
  const items = [c[2] + 4, at(c, 2, 0.35), at(c, 2, 0.68)];
  const fill = items.reduce((a, t) => a + 0.13 * prog(f, t + 10, t + 26), 0.04);
  const lock = prog(f, c[3] - 6, c[3] + 20);
  const bookIn = prog(f, c[3] + 14, c[3] + 44);
  const ticket = prog(f, c[3] + 48, c[3] + 74);
  const ask = prog(f, c[4] + 2, c[4] + 18);
  const hand = prog(f, c[4] + 26, c[4] + 54);
  const bagX = 940, bagY = 880;
  const into = (t: number, sx: number, sy: number) => ({ x: lerp(sx, bagX, t), y: lerp(sy, bagY - 170, t) - Math.sin(t * Math.PI) * 140, s: 1 - 0.55 * t, o: t >= 1 ? 0 : 1 });
  const parts = [
    { sx: 1560, sy: 520, el: <LabelTag x={-110} y={-32} w={220} h={64} text="지시" /> },
    { sx: 1560, sy: 520, el: <g><Rough shape={rect(-120, -50, 240, 100)} opt={{ seed: 501, fill: "#CFEBDD", fillStyle: "solid", strokeWidth: 3 }} /><Hand x={0} y={12} size={38} weight={700} anchor="middle">진행 상태</Hand></g> },
    { sx: 1560, sy: 520, el: <g><Rough shape={rect(-130, -80, 260, 160)} opt={{ seed: 502, fill: "#FFFDF6", fillStyle: "solid", strokeWidth: 3 }} /><Hand x={-110} y={-28} size={30} weight={700}>목록</Hand><text x={-110} y={14} fontFamily="D2Coding" fontSize={22} fill={C.ink}>t:3 게이트웨이 재시작</text><text x={-110} y={46} fontFamily="D2Coding" fontSize={22} fill={C.ink}>t:2 스테이징 배포</text></g> },
  ];
  return (
    <Paper>
      <Camera keys={[{ f: 0, x: 960, y: 540, s: 1 }, { f: c[3] - 10, x: 960, y: 540, s: 1 }, { f: c[3] + 14, x: 1160, y: 500, s: 1.06 }, { f: c[4] - 6, x: 1160, y: 500, s: 1.06 }, { f: c[4] + 18, x: 900, y: 540, s: 1.0 }]}>
        <Svg>
          <Floor />
          <Sun x={560} y={190} draw={prog(f, 0, 20)} />
          <Rough shape={rect(120, 380, 220, 520)} opt={{ seed: 511, strokeWidth: 4 }} draw={prog(f, 0, 18)} />
          <LabelTag x={130} y={330} w={220} h={60} text="새 세션" write={prog(f, 6, 24)} />
          <Robot x={lerp(230, 620, walk)} y={900} face={f < c[1] ? "q" : "ok"} run={walk > 0 && walk < 1} arms={hand > 0 ? "reach" : "down"} />
          <Mascot x={1250} y={900} size={0.75} pose={f < c[1] ? "ask" : "point"} />
          {bag > 0 && <Bag x={bagX} y={bagY} size={0.9} draw={bag} />}
          {bag > 0 && <Gauge x={1560} y={850} value={fill} size={0.85} draw={bag} />}
          {parts.map((p, i) => {
            const t = prog(f, items[i], items[i] + 26);
            if (prog(f, items[i] - 6, items[i]) <= 0) return null;
            const q = into(t, p.sx, p.sy);
            return <g key={i} transform={`translate(${q.x} ${q.y}) scale(${q.s})`} opacity={q.o}>{p.el}</g>;
          })}
          {lock > 0 && <Lockers x={1340} y={230} nums={["t:1", "t:2", "t:3", "t:4", "t:5", "t:6"]} draw={lock} open={bookIn > 0.95 ? 1 : -1} />}
          {lock > 0 && bookIn < 1 && <Book x={lerp(1150, 1555, bookIn)} y={lerp(560, 330, bookIn) - Math.sin(bookIn * Math.PI) * 80} s={1 - 0.45 * bookIn} />}
          {ticket > 0 && ticket < 1 && <Ticket x={lerp(1555, bagX, ticket)} y={lerp(380, bagY - 170, ticket) - Math.sin(ticket * Math.PI) * 120} text="t:2" />}
          {ask > 0 && <Bubble x={60} y={110} w={560} h={110} text="본딩 정보 어디 저장돼?" tail={[120, 60]} write={ask} />}
          {hand > 0 && hand < 1 && <g transform={`translate(${lerp(1200, 720, hand)} ${lerp(600, 560, hand) - Math.sin(hand * Math.PI) * 100}) scale(0.62)`}><Slip x={0} y={0} w={420} lines={["본딩 정보는", "/data/bt/bond.db"]} seed={14} /></g>}
          {hand >= 1 && <g transform="translate(700 520) scale(0.62)"><Slip x={0} y={0} w={420} lines={["본딩 정보는", "/data/bt/bond.db"]} seed={14} /></g>}
        </Svg>
      </Camera>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S5 절차: 탭에 '언제 쓰는지'만 보이는 카드 상자 ───────────────────────── */
export const Procedure: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const box = prog(f, 2, 30);
  const ask = prog(f, c[1] - 4, c[1] + 12);
  const lift = prog(f, c[1] + 10, c[1] + 28);
  const card = prog(f, c[1] + 26, c[1] + 46);
  const ck = [prog(f, c[1] + 52, c[1] + 64), prog(f, c[1] + 70, c[1] + 82)];
  const warn = usePop(c[1] + 86, 10);
  return (
    <Paper>
      <Camera keys={[{ f: 0, x: 760, y: 560, s: 1.12 }, { f: c[1] + 20, x: 760, y: 560, s: 1.12 }, { f: c[1] + 44, x: 1000, y: 540, s: 1.0 }]}>
        <Svg>
          <Floor />
          <CardBox x={160} y={700} tabs={["인증서 갱신할 때", "스테이징에 배포할 때", "게이트웨이 재시작할 때"]} draw={box} lift={lift} pick={2} />
          {ask > 0 && <Bubble x={200} y={120} w={560} h={110} text="게이트웨이 재시작해 줘" tail={[80, 50]} write={ask} />}
          <Robot x={1700} y={900} size={0.9} face={card > 0 ? "happy" : "ok"} arms={card > 0 ? "reach" : "down"} />
          {card > 0 && (
            <g transform={`translate(${lerp(500, 1000, card)} ${lerp(500, 260, card)}) scale(${0.6 + 0.4 * card})`}>
              <Rough shape={rect(0, 0, 640, 470)} opt={{ seed: 521, fill: "#FFF9E3", fillStyle: "solid", strokeWidth: 3.5 }} />
              <rect x={0} y={0} width={640} height={70} fill={C.marker} />
              <Hand x={24} y={50} size={42} weight={700}>게이트웨이 재시작 순서</Hand>
              <Hand x={40} y={150} size={46} weight={700}>1. mqtt-broker</Hand>
              <Hand x={40} y={230} size={46} weight={700}>2. ble-bridge</Hand>
              <Check x={460} y={136} draw={ck[0]} />
              <Check x={460} y={216} draw={ck[1]} />
              <Rough shape={line(30, 290, 610, 290)} opt={{ seed: 522, strokeWidth: 2, stroke: C.ink3 }} />
              <g opacity={Math.min(1, warn)}>
                <Splat x={70} y={370} r={34} s={warn} seed={8} />
                <Hand x={120} y={360} size={36} weight={700} color={C.red}>주의: 반대로 하면</Hand>
                <Hand x={120} y={410} size={36} weight={700} color={C.red}>재연결 폭주</Hand>
              </g>
            </g>
          )}
        </Svg>
      </Camera>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S6 이어받기: 바통(진행 상태)을 넘기는 이어달리기, 열 턴마다 깃발 ─────── */
export const Handoff: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const run = prog(f, 6, c[1] + 16);
  const ax = lerp(180, 1180, run);
  const flags = [470, 760, 1050];
  const passed = flags.filter((x) => ax > x).length;
  const pass = prog(f, c[1] + 20, c[1] + 42);
  const term = prog(f, c[1] + 44, c[1] + 54);
  const done = ["✓ 토큰 갱신 원인", "✓ 미들웨어 분리", "· ACL 캐시 TTL"];
  const card = (n: number) => (
    <g>
      <Rough shape={rect(-115, -150, 230, 150)} opt={{ seed: 531, fill: "#CFEBDD", fillStyle: "solid", strokeWidth: 3 }} />
      <Hand x={-100} y={-112} size={32} weight={700}>진행 상태</Hand>
      {done.slice(0, n).map((t, i) => <Hand key={i} x={-100} y={-74 + i * 32} size={26} weight={700}>{t}</Hand>)}
    </g>
  );
  const bx = lerp(ax + 30, 1430, pass), by = lerp(560, 600, pass);
  return (
    <Paper>
      <Camera keys={[{ f: 0, x: 900, y: 660, s: 1.22 }, { f: c[1], x: 960, y: 650, s: 1.22 }, { f: c[1] + 30, x: 1120, y: 640, s: 1.18 }]}>
      <Svg>
        <Rough shape={line(80, 905, 1840, 900)} opt={{ seed: 541, strokeWidth: 3, stroke: C.ink2 }} />
        <Rough shape={line(80, 935, 1840, 930)} opt={{ seed: 542, strokeWidth: 2, stroke: C.ink3 }} />
        {flags.map((x, i) => <Flag key={x} x={x} y={900} text="10턴" draw={prog(f, 4 + i * 5, 20 + i * 5)} color={ax > x ? C.state : C.marker} />)}
        <Robot x={ax} y={900} size={0.82} name="Claude Code" run={run < 1} arms="hold" tint="#F6DCCB" />
        <Robot x={1480} y={900} size={0.82} name="OpenCode" arms={pass > 0 ? "hold" : "down"} face={pass >= 1 ? "happy" : "ok"} />
        <g transform={`translate(${bx} ${by})`}>{card(Math.max(passed, pass >= 1 ? 3 : 0))}</g>
      </Svg>
      </Camera>
      {term > 0 && (
        <div style={{ opacity: term }}>
          <Terminal x={820} y={200} w={860} h={210} title="OpenCode · ble-gateway" cps={2} lines={[
            { at: c[1] + 46, kind: "cmd", text: "/resume" },
            { at: c[1] + 60, kind: "ok", text: "남은 일: broker/acl_cache.py의 TTL 확인" },
          ]} />
        </div>
      )}
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S7 믿고 쓰기: 연필 메모(미확인)와 펜 메모 ───────────────────────────── */
export const Trust: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const slip = prog(f, 2, 24);
  const blocked = prog(f, c[0] + 34, c[0] + 50) * (1 - prog(f, c[1] + 20, c[1] + 34));
  const ink = prog(f, c[1] + 14, c[1] + 34);
  const go = prog(f, c[1] + 50, c[1] + 96);
  const inBag = usePop(c[1] + 98, 9);
  const sx = lerp(420, 1360, go), sy = lerp(330, 700, go) - Math.sin(go * Math.PI) * 160, ss = 1 - 0.7 * go;
  return (
    <Paper>
      <Svg>
        <Floor />
        <Bag x={1440} y={880} size={0.9} />
        {go < 1 && (
          <g transform={`translate(${sx} ${sy}) scale(${ss})`} opacity={slip}>
            <rect x={6} y={8} width={520} height={190} fill="rgba(60,45,20,0.08)" />
            <rect x={0} y={0} width={520} height={190} fill="#FFFDF6" />
            <Rough shape={rect(0, 0, 520, 190)} opt={{ seed: 551, strokeWidth: 2.5, stroke: C.ink3 }} dash="10 9" />
            <g opacity={ink}><Rough shape={rect(0, 0, 520, 190)} opt={{ seed: 552, strokeWidth: 3 }} draw={ink} /></g>
            <Hand x={28} y={78} size={50} color={ink > 0.5 ? C.ink : "#8E929D"} weight={ink > 0.5 ? 700 : 400}>OTA 청크 크기는</Hand>
            <Hand x={28} y={140} size={50} color={ink > 0.5 ? C.ink : "#8E929D"} weight={ink > 0.5 ? 700 : 400}>244바이트</Hand>
            <LabelTag x={330} y={-36} w={190} h={56} text={ink > 0.5 ? "확인됨" : "미확인"} fill={ink > 0.5 ? C.marker : "#D7D9DE"} />
            <Check x={460} y={150} draw={ink} s={1.3} />
          </g>
        )}
        {/* 연필 */}
        <g transform={`translate(${lerp(980, 1100, ink)} 260) rotate(38)`} opacity={(1 - go) * slip}>
          <Rough shape={rect(0, 0, 260, 34)} opt={{ seed: 561, fill: ink > 0.3 ? "#2B3346" : "#F2C14E", fillStyle: "solid", strokeWidth: 3 }} />
          <Rough shape={path("M 260 0 L 310 17 L 260 34 Z")} opt={{ seed: 562, fill: "#E9C9A0", fillStyle: "solid", strokeWidth: 3 }} />
          <Hand x={30} y={28} size={28} weight={700} color={ink > 0.3 ? "#fff" : C.ink}>{ink > 0.3 ? "펜" : "연필"}</Hand>
        </g>
        {blocked > 0 && (
          <g opacity={blocked}>
            <Rough shape={path("M 960 470 Q 1150 420 1310 640")} opt={{ seed: 571, strokeWidth: 4, stroke: C.ink2 }} />
            <Rough shape={line(1090, 450, 1190, 550)} opt={{ seed: 572, strokeWidth: 8, stroke: C.red }} />
            <Rough shape={line(1190, 450, 1090, 550)} opt={{ seed: 573, strokeWidth: 8, stroke: C.red }} />
          </g>
        )}
        <Mascot x={760} y={900} size={0.78} pose={go > 0.6 ? "happy" : ink > 0 ? "point" : "ask"} />
        {inBag > 0 && <g transform={`translate(1440 560) scale(${inBag})`}><Check x={0} y={0} s={2.2} /><Hand x={0} y={-70} size={48} weight={700} anchor="middle">가방에 넣음</Hand></g>}
      </Svg>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S8 함께 쓰기: 위키 근거(증거 카드) → 팀 게시판 → 동료의 에이전트 ─────── */
export const Team: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const pin = usePop(c[1] + 46, 8);
  if (f < c[1]) {
    // 증거 카드: 실제 위키 화면(데모 계정)에 근거 번호 강조
    const circle = prog(f, c[0] + 24, c[0] + 44);
    const IW = 1008, IH = 553, s = 1.25, x = (W - IW * s) / 2, y = 150;
    return (
      <Desk>
        <div style={{ position: "absolute", left: x - 20, top: y - 60, width: IW * s + 40, height: IH * s + 80, background: "#fff", borderRadius: 14, boxShadow: "0 20px 50px rgba(20,26,38,0.18)", overflow: "hidden" }}>
          <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: "#F3F4F7", borderBottom: "1px solid #E3E5EA" }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((col) => <div key={col} style={{ width: 13, height: 13, borderRadius: 7, background: col }} />)}
            <div style={{ marginLeft: 14, color: "#7A8193", fontFamily: SANS, fontSize: 20 }}>Conntext · 위키 · 스테이징 배포</div>
          </div>
          <Img src={staticFile("shots/wiki.png")} style={{ position: "absolute", left: 20, top: 60, width: IW * s }} />
        </div>
        <Svg>
          <Rough shape={ellipse(x + 868 * s, y + 240 * s, 90, 80)} opt={{ seed: 581, stroke: C.red, strokeWidth: 5 }} draw={circle} />
          <Rough shape={path(`M ${x + 920 * s} ${y + 200 * s} Q ${x + 1060 * s} ${y + 120 * s} ${x + 1100 * s} ${y + 60 * s}`)} opt={{ seed: 582, stroke: C.red, strokeWidth: 4 }} draw={prog(f, c[0] + 40, c[0] + 56)} />
          <Hand x={x + 1110 * s} y={y + 40 * s} size={48} weight={700} color={C.red} write={prog(f, c[0] + 50, c[0] + 66)}>근거 메모</Hand>
        </Svg>
        <Overlay sc={sc} />
      </Desk>
    );
  }
  const board = prog(f, c[1] + 2, c[1] + 26);
  const fly = prog(f, c[1] + 18, c[1] + 44);
  const reader = prog(f, c[2], c[2] + 22);
  const link = prog(f, c[2] + 20, c[2] + 40);
  return (
    <Paper>
      <Svg>
        <Floor />
        <Board x={480} y={210} w={860} h={520} title="Connectivity 팀" draw={board} />
        <g transform={`translate(${lerp(-300, 620, fly)} ${lerp(500, 330, fly)}) rotate(${lerp(-30, -2, fly)})`}>
          <Slip x={0} y={0} w={470} h={170} rot={0} lines={["스테이징 배포는", "목요일 오전만"]} seed={15} tape={false} />
          <LabelTag x={300} y={140} w={180} h={52} text="정도현" />
        </g>
        <Pin x={850} y={338} s={pin} />
        <g transform="translate(560 700) scale(0.5)" opacity={board}><Slip x={0} y={-220} w={420} lines={["헬스체크는", "/healthz"]} seed={16} tape={false} /></g>
        <Robot x={1640} y={900} size={0.86} name="오지민" face={link > 0.9 ? "happy" : "ok"} draw={reader} />
        {link > 0 && <Rough shape={path("M 1100 460 Q 1400 380 1560 560")} opt={{ seed: 591, strokeWidth: 3, stroke: C.team }} dash="12 10" draw={link} />}
        {link > 0.6 && <LabelTag x={1380} y={330} w={420} h={60} text="[팀 지식 · 정도현]" mono size={28} fill="#DCE6FB" write={prog(f, c[2] + 34, c[2] + 46)} />}
        <Mascot x={260} y={900} size={0.72} pose={pin > 0.5 ? "happy" : "point"} />
      </Svg>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S9 지키기: 저장 전 가림, 운영자는 계기판만, 예외 열람은 기록·알림 ──────── */
export const Safe: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const bar1 = prog(f, c[0] + 18, c[0] + 40), bar2 = prog(f, c[0] + 40, c[0] + 60);
  const win = prog(f, c[1] - 4, c[1] + 20);
  const crack = prog(f, c[1] + 44, c[1] + 54);
  const note = usePop(c[1] + 56, 10);
  const ring = prog(f, c[1] + 62, c[1] + 70);
  return (
    <Paper>
      <Svg>
        <Floor />
        <g transform="translate(140 220)">
          <Rough shape={rect(0, 0, 700, 240)} opt={{ seed: 601, fill: "#FFFDF6", fillStyle: "solid", strokeWidth: 2.6 }} draw={prog(f, 0, 18)} />
          <text x={30} y={90} fontFamily="D2Coding" fontSize={38} fill={C.ink}>api_key = sk-live-8f3a9c…</text>
          <text x={30} y={170} fontFamily="D2Coding" fontSize={38} fill={C.ink}>담당 010-1234-5678</text>
          <rect x={210} y={52} width={440 * bar1} height={54} fill="#1E2433" />
          <rect x={120} y={132} width={330 * bar2} height={54} fill="#1E2433" />
          {bar1 >= 1 && <Hand x={230} y={92} size={34} weight={700} color="#fff">[마스킹]</Hand>}
          {bar2 >= 1 && <Hand x={140} y={172} size={34} weight={700} color="#fff">[마스킹]</Hand>}
        </g>
        <g transform={`translate(${lerp(-80, 170, prog(f, c[0] + 14, c[0] + 40)) + 650 * prog(f, c[0] + 40, c[0] + 60)} 200) rotate(-30)`} opacity={prog(f, c[0] + 10, c[0] + 16) * (1 - prog(f, c[0] + 62, c[0] + 70))}>
          <Rough shape={rect(0, 0, 60, 170)} opt={{ seed: 611, fill: "#1E2433", fillStyle: "solid", strokeWidth: 3 }} />
          <Hand x={8} y={130} size={26} weight={700} color="#fff" rotate={-90}>마커</Hand>
        </g>
        {win > 0 && (
          <g>
            <Rough shape={rect(1060, 160, 700, 470)} opt={{ seed: 621, fill: "#EEF6FA", fillStyle: "solid", strokeWidth: 5 }} draw={win} />
            <Rough shape={line(1410, 160, 1410, 630)} opt={{ seed: 622, strokeWidth: 3 }} draw={win} />
            <LabelTag x={1090} y={110} w={260} h={60} text="운영 화면" write={win} />
            <Gauge x={1235} y={420} value={0.35} size={0.7} draw={win} label="지연" />
            <Gauge x={1585} y={420} value={0.6} size={0.7} draw={win} label="비용" />
            <Stick x={1410} y={900} size={0.62} draw={win} />
          </g>
        )}
        <GlassBox x={720} y={900} crack={crack} draw={win} />
        {note > 0 && <g transform={`translate(560 560) scale(${note})`}><Slip x={0} y={0} w={300} h={110} rot={-4} lines={["사유: 장애 조사"]} seed={17} /></g>}
        <Stick x={300} y={900} size={0.72} pose={ring > 0 ? "think" : "idle"} draw={win} />
        {ring > 0 && <Bell x={420} y={520} ring={ring} />}
        {ring > 0 && <Hand x={480} y={470} size={40} weight={700} write={ring}>본인 알림</Hand>}
      </Svg>
      <Overlay sc={sc} />
    </Paper>
  );
};

/* ── S10 정리: 책상으로 돌아와 한 번에 통과, 뒤로 빠지며 모든 비유, 로고 ────── */
export const Outro: React.FC<SceneProps> = ({ sc }) => {
  const f = useCurrentFrame(), c = sc.cues;
  const pass = usePop(c[0] + 22, 9);
  const others = prog(f, c[1], c[1] + 24);
  const logo = usePop(c[2] - 2, 14);
  return (
    <Paper>
      <Camera keys={[{ f: 0, x: 900, y: 600, s: 1.15 }, { f: c[1] - 6, x: 900, y: 600, s: 1.15 }, { f: c[1] + 30, x: 960, y: 560, s: 0.78 }]}>
        <Svg>
          <Floor x0={-300} x1={2200} />
          <Stick x={470} y={900} pose="idle" />
          <Robot x={1000} y={900} face={pass > 0.5 ? "happy" : "ok"} arms={pass > 0.5 ? "up" : "down"} />
          <Bag x={1240} y={900} size={0.6} />
          <g transform={`translate(1000 280) scale(${pass})`}>
            <Rough shape={ellipse(0, 0, 260, 150)} opt={{ seed: 631, stroke: C.state, strokeWidth: 6 }} />
            <Hand x={0} y={18} size={56} weight={700} anchor="middle" color={C.state}>테스트 통과</Hand>
          </g>
          <g opacity={others}>
            <g transform="translate(-260 30) scale(0.55)"><Cabinet /></g>
            <g transform="translate(-200 780) scale(0.5)"><CardBox x={0} y={0} tabs={["인증서 갱신할 때", "스테이징에 배포할 때", "게이트웨이 재시작할 때"]} /></g>
            <Robot x={1700} y={900} size={0.7} name="OpenCode" face="happy" />
            <Robot x={2020} y={900} size={0.7} name="오지민" face="happy" />
            <g transform="translate(1560 -40) scale(0.45)"><Board x={0} y={0} w={860} h={520} title="Connectivity 팀" /></g>
          </g>
        </Svg>
      </Camera>
      {logo > 0 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, transform: `scale(${0.8 + 0.2 * logo})`, opacity: Math.min(1, logo * 1.5), background: "rgba(243,236,219,0.92)", padding: "40px 80px 34px", borderRadius: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ background: C.marker, padding: "8px 56px 14px 36px", clipPath: "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)", fontFamily: SANS, fontWeight: 800, fontSize: 120, color: C.brandTile, letterSpacing: -3, lineHeight: 1 }}>conn</div>
              <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 120, color: C.ink, letterSpacing: -3, lineHeight: 1 }}>text</div>
            </div>
            <div style={{ fontFamily: HAND, fontWeight: 700, fontSize: 56, color: C.ink }}>웹 설정 → 연결에서 시작하기</div>
          </div>
        </AbsoluteFill>
      )}
      <Overlay sc={sc} />
    </Paper>
  );
};
