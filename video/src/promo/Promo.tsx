import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { C } from "../theme";
import { useFonts } from "../sketch/fonts";
import { Brand, Handoff, Hook, Inject, Outro, Procedure, Remember, Safe, Team, Trust, type SceneProps } from "./scenes";
import { TIMED } from "./timing";

const VIEWS: Record<string, React.FC<SceneProps>> = {
  hook: Hook, brand: Brand, remember: Remember, inject: Inject, procedure: Procedure,
  handoff: Handoff, trust: Trust, team: Team, safe: Safe, outro: Outro,
};

/**
 * 소개 영상. 장면 사이는 하드 컷(장면 안에서는 카메라가 움직인다).
 * audio가 false면 음성 없이 같은 장면 길이로 그린다(무음판). 음성 파일은 저장소에 없으므로
 * 새로 받은 저장소에서는 무음판만 렌더된다. 나레이션판은 scripts/narrate.py로 음성을 만든 뒤 렌더한다.
 */
export const Promo: React.FC<{ audio?: boolean }> = ({ audio = true }) => {
  useFonts();
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {TIMED.map((sc) => {
        const V = VIEWS[sc.id];
        return (
          <Sequence key={sc.id} from={sc.start} durationInFrames={sc.frames} name={sc.id}>
            <V sc={sc} />
            {/* 나레이션(scripts/narrate.py가 만든 음성). 문장 시각 cues[0]이 음성의 시작이다 */}
            {audio && sc.voiced && <Sequence from={sc.cues[0]}><Audio src={staticFile(`audio/${sc.id}.wav`)} /></Sequence>}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
