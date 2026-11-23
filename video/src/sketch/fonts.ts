import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

const FONTS: [string, string, FontFaceDescriptors?][] = [
  ["Gaegu", "fonts/Gaegu-Regular.ttf", { weight: "400" }],
  ["Gaegu", "fonts/Gaegu-Bold.ttf", { weight: "700" }],
  ["SUIT", "fonts/SUIT-Variable.woff2", { weight: "100 900" }],
  ["D2Coding", "fonts/D2Coding-Regular.woff2", { weight: "400" }],
];

/** 글꼴을 모두 불러온 뒤 렌더한다 */
export const useFonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(FONTS.map(([name, file, d]) => new FontFace(name, `url(${staticFile(file)})`, d).load()))
      .then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
};
