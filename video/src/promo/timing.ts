import { FPS } from "../theme";
import DUR from "./durations.json";
import { SCENES, type Scene } from "./script";

/** 나레이션이 없을 때 쓰는 어림: 타입캐스트 실측 초당 6.46자(공백·문장부호 제외), 문장 사이 0.35초 */
const CPS = 6.46, GAP = 0.35, HEAD = 0.3, TAIL = 0.6;
const chars = (s: string) => s.replace(/[\s,.?!·]/g, "").length;

type Dur = Record<string, { dur: number; cues: number[]; text: string }>;
const dur = DUR as unknown as Dur;

export type Timed = Scene & { start: number; frames: number; cues: number[]; voiced: boolean };

export const TIMED: Timed[] = (() => {
  let start = 0;
  return SCENES.map((sc) => {
    const d = dur[sc.id];
    let cues: number[], sec: number;
    if (d) {
      cues = [0, ...d.cues].map((t) => t + HEAD);
      sec = d.dur + HEAD + TAIL;
    } else {
      cues = [];
      let t = HEAD;
      for (const l of sc.lines) { cues.push(t); t += chars(l.say) / CPS + GAP; }
      sec = t - GAP + TAIL;
    }
    sec = Math.max(sec, sc.min ?? 0);
    const frames = Math.round(sec * FPS);
    const r: Timed = { ...sc, start, frames, cues: cues.map((c) => Math.round(c * FPS)), voiced: !!d };
    start += frames;
    return r;
  });
})();

export const TOTAL_FRAMES = TIMED.reduce((a, s) => a + s.frames, 0);
export const scene = (id: string) => TIMED.find((s) => s.id === id)!;
