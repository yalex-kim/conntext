import { AbsoluteFill } from "remotion";
import { C, HAND, SANS, W, H } from "../theme";
import { useFonts } from "../sketch/fonts";
import { Paper } from "../sketch/kit";
import { LabelTag, Mascot, Slip } from "../sketch/things";

/** 소개 페이지의 영상 포스터: 자막 없이, 아래 1/3은 재생 단추 자리로 비워 둔다 */
export const Poster: React.FC = () => {
  useFonts();
  const slips: [number, number, number, string[]][] = [[170, 150, -10, ["테스트는", "make test-hw-sim"]], [1480, 130, 8, ["broker 먼저", "재시작"]], [1500, 470, -6, ["스테이징 배포", "목요일 오전만"]]];
  return (
    <Paper>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {slips.map(([x, y, r, l], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(0.62)`}>
            <Slip x={0} y={0} w={400} rot={r} lines={l} seed={21 + i} />
            <g transform={`rotate(${r})`}><LabelTag x={250} y={-50} w={170} h={64} text={`m:${i + 1}`} mono /></g>
          </g>
        ))}
        <Mascot x={430} y={560} size={0.7} pose="happy" />
      </svg>
      <AbsoluteFill style={{ top: 250, bottom: "auto", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ background: C.marker, padding: "10px 70px 18px 44px", clipPath: "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)", fontFamily: SANS, fontWeight: 800, fontSize: 150, color: C.brandTile, letterSpacing: -4, lineHeight: 1 }}>conn</div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 150, color: C.ink, letterSpacing: -4, lineHeight: 1 }}>text</div>
        </div>
        <div style={{ marginTop: 40, fontFamily: HAND, fontWeight: 700, fontSize: 64, color: C.ink }}>적어 둔 맥락 → 다음 세션</div>
      </AbsoluteFill>
    </Paper>
  );
};
