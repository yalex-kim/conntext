import { Composition } from "remotion";
import { FPS, H, W } from "./theme";
import { Promo } from "./promo/Promo";
import { Poster } from "./promo/Poster";
import { TOTAL_FRAMES } from "./promo/timing";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} defaultProps={{ audio: true }} />
    <Composition id="PromoSilent" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} defaultProps={{ audio: false }} />
    <Composition id="Poster" component={Poster} durationInFrames={1} fps={FPS} width={W} height={H} />
  </>
);
