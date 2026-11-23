import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { C } from "../theme";
import { useFonts } from "../sketch/fonts";
import { Brand, Handoff, Hook, Inject, Outro, Procedure, Remember, Safe, Team, Trust, type SceneProps } from "./scenes";
import { TIMED } from "./timing";

const VIEWS: Record<string, React.FC<SceneProps>> = {
  hook: Hook, brand: Brand, remember: Remember, inject: Inject, procedure: Procedure,
  handoff: Handoff, trust: Trust, team: Team, safe: Safe, outro: Outro,
};

/** 소개 영상. 장면 사이는 하드 컷(장면 안에서는 카메라가 움직인다) */
export const Promo: React.FC = () => {
  useFonts();
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {TIMED.map((sc) => {
        const V = VIEWS[sc.id];
        return (
          <Sequence key={sc.id} from={sc.start} durationInFrames={sc.frames} name={sc.id}>
            <V sc={sc} />
            {/* 나레이션(scripts/narrate.py가 만든 음성). 문장 시각 cues[0]이 음성의 시작이다 */}
            {sc.voiced && <Sequence from={sc.cues[0]}><Audio src={staticFile(`audio/${sc.id}.wav`)} /></Sequence>}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
