# Conntext 소개 영상 (Remotion)

파트 사람들에게 Conntext를 알리는 1분 50초 영상. 소개 페이지(`/`)의 "2분이면 전체 그림이 보입니다" 칸에서 재생된다.
화면은 모두 코드로 그린다(스케치북 화풍, rough.js). 그림체와 설명 기법은 [STYLE.md](STYLE.md), 처음 계획은 [PLAN.md](PLAN.md)(확정 대본은 `src/promo/script.ts`).

## 만들기

Node 18 이상. 이 NAS에서는 `/volume1/dev/.tools/node`를 쓰고, 렌더용 브라우저는 Playwright의 headless shell을 `REMOTION_BROWSER`로 준다.

```bash
export PATH=/volume1/dev/.tools/node/bin:$PATH
export REMOTION_BROWSER=/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
npm install
npm run check      # 타입 검사
npm run studio     # 미리 보기
npm run render     # out/promo-voice.mp4 (public/audio/의 음성이 있으면 나레이션판, 없으면 무음판)
npm run loudnorm   # 음량 −16 LUFS → out/conntext-promo.mp4
npm run web        # 웹용 재압축(1080p, CRF 26, faststart) → ../web/assets/video/conntext-promo.mp4
npm run poster     # 포스터(자막 없음, 아래 1/3은 재생 단추 자리) → ../web/assets/video/conntext-promo-poster.jpg
```

## 나레이션

`src/promo/script.ts`의 `say`를 타입캐스트(예슬, 감정 normal 고정)로 읽는다. 방식은 `bluetoothbook/video`와 같다.

```bash
set -a; . /volume1/dev/k-history-video-agent/.env; set +a
/volume1/dev/k-history-video-agent/.venv/bin/python scripts/narrate.py [--redo hook,brand]
```

- 장면마다 `public/audio/<id>.wav`를 한 번만 만든다. 문장을 고친 장면은 `--redo`로 지정한다. 음성 파일은 저장소에 넣지 않는다.
- `src/promo/durations.json`(장면별 음성 길이, 문장 시작 시각)을 `timing.ts`가 읽어 장면 길이와 화면 전환 시각을 맞춘다. 없으면 글자 수로 어림한다(초당 6.46자).
- `say`에는 숫자·약어를 소리 나는 대로 적는다(예: 10턴 → 열 턴, /resume → 리줌). `caption`은 같은 문장을 기호로 적고 `**핵심어**`를 표시한다.
- 무료 계정의 음성이라, 바깥에 공개할 때는 설명란에 타입캐스트 표기(서비스 이름, 목소리 이름 예슬/Yeseul, 주소)를 넣는다.

## 구조

- `src/promo/script.ts` 대본(장면, 문장, 자막) · `timing.ts` 장면 길이와 문장 시각 · `scenes.tsx` 장면 열 개 · `Promo.tsx` 조립(장면 사이는 하드 컷) · `Poster.tsx` 포스터
- `src/sketch/` 그림 부품: `rough.tsx`(손그림 선, seed 고정으로 떨림 없음), `kit.tsx`(종이, 손글씨, 카메라, 자막, 장 표시), `things.tsx`(마스코트, 메모지, 라벨 태그, 얼룩, 막대 인물, 터미널), `props.tsx`(로봇, 가방, 계기판, 사물함, 카드 상자, 깃발, 게시판 등)
- 마스코트는 브랜드 마크(A)의 노란 태그. 마크의 nn 두 아치가 눈이다.
- `public/shots/wiki.png` 증거 카드에 쓰는 위키 화면(데모 계정). `public/fonts/` 개구(Gaegu, OFL), SUIT, D2Coding.
