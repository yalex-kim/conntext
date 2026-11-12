---
name: Conntext
description: 적어 둔 맥락이 다음 세션과 다른 에이전트로 이어지는 팀 메모리 서비스. 케이블 라벨과 프로토콜 규격서의 시각 언어.
colors:
  marker: "oklch(0.87 0.17 95)"
  marker-deep: "oklch(0.78 0.16 88)"
  marker-soft: "oklch(0.96 0.06 95)"
  marker-hover: "oklch(0.84 0.17 93)"
  ink: "oklch(0.22 0.04 262)"
  ink-2: "oklch(0.45 0.035 262)"
  ink-3: "oklch(0.62 0.03 262)"
  line: "oklch(0.88 0.012 262)"
  line-strong: "oklch(0.66 0.025 262)"
  ground: "oklch(0.975 0.005 250)"
  surface: "oklch(0.995 0.002 250)"
  sunken: "oklch(0.952 0.008 255)"
  on-ink: "oklch(0.975 0.005 250)"
  on-ink-2: "oklch(0.78 0.025 262)"
  ink-hover: "oklch(0.29 0.04 262)"
  ink-line: "oklch(0.36 0.035 262)"
  team: "oklch(0.50 0.17 258)"
  team-ink: "oklch(0.45 0.16 258)"
  team-soft: "oklch(0.95 0.03 258)"
  on-team: "#ffffff"
  state: "oklch(0.60 0.14 158)"
  state-ink: "oklch(0.45 0.11 158)"
  state-soft: "oklch(0.95 0.035 158)"
  warn: "oklch(0.72 0.15 62)"
  warn-ink: "oklch(0.50 0.12 58)"
  warn-soft: "oklch(0.96 0.045 70)"
  danger: "oklch(0.55 0.20 27)"
  danger-ink: "oklch(0.50 0.19 27)"
  danger-soft: "oklch(0.955 0.025 27)"
  superseded: "oklch(0.90 0.01 262)"
  term-dim: "oklch(0.68 0.03 262)"
  term-ok: "oklch(0.80 0.13 158)"
  term-err: "oklch(0.75 0.14 27)"
typography:
  display:
    fontFamily: "Paperlogy, SUIT, system-ui, sans-serif"
    fontSize: "clamp(44px, 1.2rem + 5.4vw, 96px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Paperlogy, SUIT, system-ui, sans-serif"
    fontSize: "clamp(32px, 2.2rem + 1vw, 44px)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Paperlogy, SUIT, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title-ui:
    fontFamily: "SUIT, system-ui, -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "SUIT, system-ui, -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  body-ui:
    fontFamily: "SUIT, system-ui, -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "SUIT, system-ui, -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  mono-tag:
    fontFamily: "D2Coding, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
  mono-code:
    fontFamily: "D2Coding, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  r-1: "3px"
  r-2: "6px"
  r-3: "10px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"
components:
  button-primary:
    backgroundColor: "{colors.marker}"
    textColor: "{colors.ink}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.r-2}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.marker-hover}"
  button-primary-active:
    backgroundColor: "{colors.marker-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-2}"
    padding: "0 16px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-team}"
    rounded: "{rounded.r-2}"
    padding: "0 16px"
    height: "36px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.r-2}"
    padding: "0 24px"
    height: "44px"
  button-ink-hover:
    backgroundColor: "{colors.ink-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.r-2}"
    padding: "0 12px"
    height: "36px"
  input-disabled:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-3}"
  tag-mine:
    backgroundColor: "{colors.marker}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.r-1}"
    padding: "0 12px 0 7px"
    height: "22px"
  tag-team:
    backgroundColor: "{colors.team}"
    textColor: "{colors.on-team}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.r-1}"
    height: "22px"
  tag-state:
    backgroundColor: "{colors.state}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.r-1}"
    height: "22px"
  tag-candidate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.r-1}"
    height: "22px"
  tag-superseded:
    backgroundColor: "{colors.superseded}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.r-1}"
    height: "22px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-1}"
    padding: "0 8px"
    height: "22px"
  chip-scope:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-2}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.r-3}"
  terminal:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.r-3}"
    padding: "16px 24px"
  alert-info:
    backgroundColor: "{colors.team-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "12px 16px"
  alert-warn:
    backgroundColor: "{colors.warn-soft}"
  alert-danger:
    backgroundColor: "{colors.danger-soft}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.on-ink-2}"
    rounded: "{rounded.r-2}"
    padding: "0 8px"
    height: "36px"
  rail-item-current:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.on-ink}"
---

# Design System: Conntext

## Overview

**Creative North Star: "케이블 라벨과 프로토콜 규격서"**

Conntext의 시각 세계는 연결 엔지니어가 매일 보는 두 물건에서 왔습니다. 하나는 케이블에 감아 "이 선이 어디로 가는지" 적는 노란 라벨이고, 다른 하나는 규격서의 그림 문법(메시지 시퀀스 차트의 참여자 상자와 생명선, 프레임 포맷 그림의 필드와 눈금, 절 번호)입니다. 메모가 하는 일이 라벨이 하는 일과 같다는 점이 이 세계의 근거입니다. 노랑은 브랜드의 얼굴이자 "직접 적은 메모"라는 등급이고, 잉크색 남색은 케이블과 선과 글자입니다.

밀도는 작업 도구답게 촘촘하되 차분합니다. 차가운 밝은 회백색 바탕 위에 가는 선으로 구획을 나누고, 색은 의미가 있을 때만 씁니다(노랑 = 내 메모와 주 동작, 파랑 = 팀 지식, 초록 = 진행 상태). 깊이는 그림자보다 선과 면의 톤으로 만듭니다. 화면을 떠 있게 하는 것은 대화상자, 팝오버, 토스트, 모바일 서랍뿐입니다.

이 세계가 거부하는 것은 두 기본값입니다. 개발자 도구의 기본값(검은 화면 전체 + 네온 강조)과 메모 앱의 기본값(크림색 종이 + 세리프)입니다. 어두운 면은 터미널 블록과 레일처럼 "케이블 색"으로 한정해 씁니다. 네오브루탈리즘도 아닙니다. 노랑과 잉크를 쓰지만 굳은 오프셋 그림자나 검은 상자로 누르지 않고, 선은 가늘고 정확하게 긋습니다.

**Key Characteristics:**
- 라벨 테이프 노랑과 잉크 남색 두 축, 그 위에 등급 색 셋(파랑·초록·회색)
- 메모 id는 오른쪽 끝을 V자로 자른 라벨 태그, 등급은 색과 형태로 동시에 구분
- 규격서 그림 문법: 1.5px 선, 1px 머리카락 선, 눈금 위 D2Coding 숫자
- 차가운 밝은 바탕, 선과 톤으로 만든 평평한 층
- Paperlogy(제목) + SUIT(UI·본문) + D2Coding(코드·id·수치)
- 한국어 본문: 단어 단위 줄바꿈(`keep-all`), 68ch 폭

## Colors

라벨 노랑과 잉크 남색이 세계를 정하고, 나머지 색은 모두 "등급이나 상태"라는 의미를 가질 때만 나타나는 팔레트입니다. 정본 값은 OKLCH이며 `web/assets/base.css`의 사용자 정의 속성이 원천입니다.

### Primary
- **라벨 테이프 노랑** (marker): 브랜드, 직접 적은 메모 태그(`tag-mine`), 주 동작 버튼, 소개 페이지 첫 화면 전체 면, 매뉴얼 절 번호 라벨, 레일의 현재 위치 표식, 텍스트 선택 색. 잉크 바탕 위에서는 글자·아이콘 색으로도 씁니다(레일 현재 아이콘, 터미널 프롬프트, 목차 절 번호).
- **눌린 노랑** (marker-deep): 노랑 버튼의 테두리와 눌림, 선택된 노란 면의 테두리.
- **옅은 노랑** (marker-soft): 선택된 목록 줄, 저장 결과 띠, 현재 위키 항목, 시퀀스 차트의 조건 육각형 안쪽.

### Secondary
- **팀 지식 파랑** (team): 팀 지식 태그와 프레임 그림의 팀 필드, 포커스 링, 폼 accent-color. 이 위의 글자는 흰색(on-team)입니다.
- **팀 글자 파랑** (team-ink): 밝은 바탕 위 링크 글자, 정보 알림 제목. **옅은 파랑**(team-soft): 정보 알림 면, 팀 색인 필드.

### Tertiary
- **진행 상태 초록** (state / state-ink / state-soft): 진행 상태 태그와 필드. 초록 채움 위 글자는 잉크입니다.
- **주의 주황** (warn / warn-ink / warn-soft): 주의 알림, 제안 상자, 신고 사유.
- **위험 빨강** (danger / danger-ink / danger-soft): 삭제·위험 버튼, 오류 메시지, 입력 오류 테두리, 위험 구역 머리선.

### Neutral
- **잉크** (ink): 본문 글자, 앱·매뉴얼 레일 바탕, 터미널 바탕, 그림의 선, 구획 머리선.
- **보조 잉크** (ink-2): 보조 글자, 메타 정보, 표 머리 글자. 밝은 바탕에서 4.5:1 이상.
- **흐린 잉크** (ink-3): 비활성 글자, 눈금, 목록 기호. 본문 글자 금지.
- **선** (line) / **진한 선** (line-strong): 구분선 / 입력·보조 버튼 테두리와 생명선.
- **바탕** (ground): 페이지 바탕, 차가운 밝은 회백색. **면** (surface): 패널, 입력, 행동 상자. **움푹한 면** (sunken): 표 머리, 인라인 코드, 인용, 비활성 입력.
- **잉크 위 글자** (on-ink / on-ink-2), **잉크 위 눌림** (ink-hover), **잉크 위 선** (ink-line): 레일·터미널·토스트 안.
- **대체됨 회색** (superseded): 대체된 메모 태그.
- **터미널 보조색** (term-dim / term-ok / term-err): 터미널 안의 흐린 줄, 성공 줄, 오류 줄. 토스트 아이콘도 같은 색을 씁니다.

### Named Rules
**The 노랑 위 잉크 Rule.** 노랑 면 위 글자는 언제나 잉크입니다. 노랑 글자는 잉크 바탕 위에서만 씁니다. 밝은 바탕 위 노랑 글자는 없습니다.

**The 의미 있는 색 Rule.** 파랑·초록·주황·빨강은 등급이나 상태를 말할 때만 나타납니다. 장식용 강조색은 없습니다. 노랑조차 "내 메모, 주 동작, 현재 위치, 브랜드" 중 하나를 뜻합니다.

**The 차가운 바탕 Rule.** 바탕은 푸른 기가 도는 회백색(hue 250)입니다. 크림색·종이색 바탕을 쓰지 않습니다.

## Typography

**Display Font:** Paperlogy 700/800 (SUIT, system-ui로 대체)
**Body Font:** SUIT Variable 100–900 (system-ui, Apple SD Gothic Neo, Malgun Gothic로 대체)
**Label/Mono Font:** D2Coding (ui-monospace, Menlo, Consolas로 대체)

**Character:** Paperlogy의 굵고 단단한 한글 제목이 라벨에 꾹 눌러 쓴 글씨처럼 서고, SUIT가 작업 화면의 모든 글을 조용히 받칩니다. D2Coding은 명령어, 메모 id, 저장소 이름, 눈금 숫자에만 나타나 "데이터"라는 표시가 됩니다. 글꼴은 모두 자체 호스팅합니다.

### Hierarchy
- **Display** (Paperlogy 800, `clamp(44px, 1.2rem + 5.4vw, 96px)`, 1.08, -0.035em): 소개 페이지 첫 화면 제목 하나에만.
- **Headline** (Paperlogy 800, `--fs-8` 32–44px, 1.2, -0.02em): 문서의 h1, 설치 절 제목. 매뉴얼 h1은 34–48px 유동값을 씁니다.
- **Title** (Paperlogy 700, `--fs-7` 28px, 1.2, -0.015em): h2, 앱 화면 제목, 위키 문서 제목. 모바일에서는 22px로 내려갑니다. 소개 페이지 단계 제목과 매뉴얼 절 제목은 24–32px 유동값.
- **Title UI** (SUIT 700, 18px, -0.01em): 앱 안의 구획 제목, 대화상자 제목, 세션 제목. 앱 내부 구획은 Paperlogy가 아니라 SUIT로 씁니다.
- **Body** (SUIT 400, 16px, 1.7, 최대 68ch): 문서 본문, 메모 원문, 매뉴얼 단.
- **Body UI** (SUIT 400–600, 14px, 1.45–1.6): 버튼, 입력, 표, 목록 줄, 알림.
- **Label** (SUIT 600, 13px, 1.45): 입력 라벨, 표 머리, 메타. 레일 무리 이름은 12px.
- **Mono tag** (D2Coding 400, 12.5px, 1, tabular-nums): 라벨 태그, 저장소 칩, 목차 번호. 눈금 숫자는 11–11.5px.
- **Mono code** (D2Coding 400, 14px, 1.65): 터미널. 좁은 화면과 단계 안에서는 12–13.5px.

### Named Rules
**The 데이터만 고정폭 Rule.** D2Coding은 코드, 명령어, 메모 id, 저장소 이름, 수치, 눈금에만 씁니다. 기술적으로 보이려고 본문이나 제목에 쓰지 않습니다. 표와 눈금의 숫자는 `tabular-nums`입니다.

**The 단어 단위 줄바꿈 Rule.** 한국어 본문은 `word-break: keep-all`, 제목은 `text-wrap: balance`, 문단은 `text-wrap: pretty`입니다. 대문자 변환이나 넓은 자간의 작은 라벨은 쓰지 않습니다.

## Layout

세 표면이 같은 토큰을 쓰되 다른 뼈대를 가집니다.

- **앱(Operate):** 왼쪽 232px 잉크 레일 + 본문. 위쪽에 붙는 입력창 띠(바탕 92% 반투명 + blur 6px, 아래 1px 선), 화면 폭 최대 1320px, 여백 24/32px. 목록과 상세는 나란히(1fr : 1.1fr), 상세는 위쪽 84px에 붙습니다. 위키는 248px 목차 + 본문 + 320px 옆 패널. 899px 이하에서 레일은 300px 서랍이 되고 52px 위 띠가 생깁니다. 1023px 이하에서 목록·상세는 한 번에 하나만 보이고 "뒤로"가 나타납니다.
- **매뉴얼(Read):** 왼쪽 288px 고정 잉크 목차 레일 + 최대 720px 본문 단(좌우 64px 여백). 위쪽에 현재 절을 보여 주는 얇은 띠. 860px 이하에서 레일은 접히는 위 띠가 됩니다.
- **소개(Persuade):** 최대 1360px. 왼쪽 440px 글 단 + 오른쪽 생명선 네 줄 영역(각 25%). 1180px 이하에서 글 단 360px, 860px 이하에서 생명선 넷을 왼쪽 84px 레일로 모읍니다.

간격은 4px 기반 9단(4·8·12·16·24·32·48·64·96)을 씁니다. 목록 줄은 12px 위아래, 구획 사이는 48px, 소개 페이지 단계 사이는 96px입니다. 컨트롤 높이는 36px(기본), 28px(작게), 44px(크게)로 고정입니다.

**The 표준 뼈대 Rule.** 앱은 익숙한 작업 도구의 뼈대(레일, 목록과 상세)를 유지하고, 세계는 태그와 그림에서 드러냅니다. 숫자 타일을 늘어놓은 대시보드 격자나 같은 크기 카드 줄로 화면을 채우지 않습니다.

## Elevation & Depth

평평한 층 체계입니다. 깊이는 바탕(ground) → 면(surface) → 움푹한 면(sunken)의 톤 차이와 1px 선으로 만듭니다. 패널, 표, 메모 원문, 프레임 그림은 모두 테두리만 있고 그림자가 없습니다. 그림자는 화면 위에 떠서 다른 것을 가리는 요소에만 씁니다. 그림자 색은 검정이 아니라 잉크 남색입니다.

### Shadow Vocabulary
- **떠 있는 층** (`--shadow-3`: `0 16px 40px -8px oklch(0.22 0.04 262 / 0.22), 0 4px 10px -4px oklch(0.22 0.04 262 / 0.10)`): 대화상자, 입력창 팝오버, 토스트, 모바일 레일 서랍, 모바일 옆 패널 시트.
- **포커스 둘레** (`0 0 0 3px oklch(0.50 0.17 258 / 0.18)`): 입력의 포커스. 메모 입력창은 노랑 둘레(`0 0 0 3px oklch(0.87 0.17 95 / 0.45)`)를 씁니다.
- **노랑 버튼 아랫단** (`inset 0 -1px 0 oklch(0.78 0.16 88 / 0.6)`): 주 동작 버튼 아래쪽의 얇은 눌림 선.

### Named Rules
**The 뜨는 것만 그림자 Rule.** 그림자는 가리는 층(대화상자, 팝오버, 토스트, 서랍)에만 있습니다. 쉬고 있는 면은 선과 톤으로 나눕니다. 굳은 오프셋 그림자는 쓰지 않습니다.

## Shapes

모서리는 작고 일정합니다. 태그와 칩과 인라인 코드는 3px, 버튼과 입력과 알림은 6px, 패널과 표와 터미널과 대화상자는 10px, 스위치만 완전히 둥급니다. 규격서 그림(행동 상자, 참조 틀, 색 견본)은 2px 이하로 거의 각지게 그립니다.

이 세계의 고유한 형태는 **라벨 테이프를 자른 V자 노치**입니다. 왼쪽은 살짝 둥글고 오른쪽 끝을 V자로 자른 모양(`clip-path` 다섯 꼭짓점)이 메모 태그, 매뉴얼 절 번호, 설치 단계 번호, 레일의 현재 위치 표식, 추적 그림의 마디에 반복됩니다. 그 밖의 그림 형태는 규격서에서 가져옵니다: 끝이 채워진 삼각 화살촉, 시퀀스 차트 조건의 육각형, 접힌 귀퉁이가 있는 주석 상자, 탭이 달린 참조 틀, 생명선 끝의 짧은 막대, 빗금 채움(남은 예산·오버헤드).

선 굵기는 두 가지가 기준입니다. 그림의 테두리와 화살표는 1.5px(`--dg-stroke`), 필드 구분과 눈금은 1px(`--dg-hair`). 구획 머리선은 잉크 1px(앱)과 잉크 2px(매뉴얼 절, 페이지 넘김)입니다.

**The 노치는 라벨에만 Rule.** V자 노치는 "라벨이 붙었다"는 뜻일 때만 씁니다(등급 태그, 번호, 현재 위치). 일반 버튼이나 패널의 모서리에 쓰지 않습니다.

**The 심볼은 라벨 태그 Rule.** 심볼(`mark.svg`)은 잉크 칸 위의 노치 있는 노란 라벨 태그에 `nn`을 적은 것입니다. 워드마크의 `conn` 라벨이 `nn`만 품고 줄어든 모양이며, 인트로(`web/intro.html`)가 이 관계를 보여 줍니다. 16px 파비콘(`favicon.svg`)은 태그를 칸에 꽉 채우고 `nn`을 굵게 한 판입니다.

## Components

### Buttons
단정하고 납작합니다. 노랑은 화면에서 가장 중요한 한 동작에만.
- **Shape:** 6px 모서리, 높이 36px(작게 28, 크게 44), 좌우 16px, SUIT 600 14px.
- **Primary:** 노랑 채움, 잉크 글자, 눌린 노랑 테두리, 아래쪽 1px 안쪽 선. 눌림은 눌린 노랑.
- **Hover / Focus:** 배경만 120ms에 바뀝니다. 포커스는 2px 팀 파랑 바깥 선(2px 띄움). 잉크 바탕 안에서는 포커스 선이 노랑.
- **Secondary:** 면 색 + 진한 선 테두리, hover에 움푹한 면. **Quiet:** 배경·테두리 없이 보조 잉크 글자, hover에 잉크 6% 막. **Danger:** 빨강 채움 + 흰 글자.
- **Ink (노란 면 위 주 동작):** 잉크 채움 + 잉크 위 글자. 노란 면에서 보조 동작은 잉크 테두리만 있는 버튼.
- **Loading:** `aria-busy`이면 글자를 숨기고 가운데에 회전 고리.
- 동작의 방향은 `icons.svg`의 화살표 아이콘을 글자 뒤에 붙여 나타냅니다.

### Chips
- **Style:** 22px 높이, 3px 모서리, SUIT 600 12px, 보조 잉크 글자, 진한 선 테두리. 종류(주제 문서, 새 주제)를 말합니다.
- **Variants:** 범위 칩은 움푹한 면 + 아이콘, 저장소 칩은 D2Coding + 면 색 + 옅은 선. 앱에서는 주의/위험/진행 상태 칩이 각 색의 soft 면과 ink 글자를 씁니다.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** 면(surface) 위에 1px 선(line). 패널 안에 패널을 두지 않습니다.
- **Shadow Strategy:** 없음(Elevation 참고).
- **Internal Padding:** 12–16px(목록·메모), 16–24px(프레임 그림, 대화상자).

### Inputs / Fields
- **Style:** 면 색, 진한 선 1px 테두리, 6px 모서리, 높이 36px, 좌우 12px. hover에 테두리가 보조 잉크로.
- **Focus:** 테두리가 팀 파랑, 바깥에 3px 옅은 파랑 둘레.
- **Error / Disabled:** `aria-invalid`이면 빨강 테두리와 옅은 빨강 둘레, 아래에 아이콘 + 빨강 글자 오류. 비활성은 움푹한 면 + 흐린 잉크.
- **스위치:** 꺼짐은 진한 선 회색, 켜짐은 잉크 트랙에 노랑 손잡이.
- **메모 입력창(앱 위 띠):** 10px 모서리의 넓은 입력. 포커스 때 잉크 테두리 + 노랑 둘레(저장), 고르는 중에는 파랑 둘레(검색).

### Navigation
- **앱 레일:** 잉크 바탕, 항목 높이 36px, SUIT 600 14px, 잉크 위 보조 글자. hover와 현재 항목은 잉크 위 눌림 면, 현재 항목은 아이콘이 노랑이고 오른쪽 끝에 노치 있는 작은 노란 라벨 조각이 붙습니다. 모바일에서는 300px 서랍.
- **매뉴얼 목차 레일:** 잉크 바탕, 절 번호는 D2Coding(최상위 번호는 노랑), 현재 절은 왼쪽 5px 노란 막대.
- **탭:** 40px 높이, 보조 잉크 글자, 현재 탭은 잉크 글자 + 아래 2px 잉크 선.
- **소개 페이지 위 띠:** 56px 잉크 띠, 워드마크와 글자 링크.
- **링크:** 팀 글자 파랑, 밑줄은 글자 색 40% · 1px · 0.22em 띄움, hover에 2px 진한 밑줄.

### 등급 라벨 태그 (Signature)
메모 id(`m:142`, `t:12`)를 와이어 마커처럼 그리는 이 시스템의 얼굴입니다. 22px 높이(큰 크기 30px), D2Coding 12.5px, 오른쪽 끝 V자 노치. 등급은 색과 형태로 동시에 구분합니다: 내 메모는 노란 채움, 팀 지식은 파란 채움 + 흰 글자 + 곁에 작성자 이름, 진행 상태는 초록 채움, 세션 추출 후보는 흰 바탕 + 잉크 점선 테두리(노치까지 점선), 대체됨은 회색 + 취소선. 링크나 버튼으로 쓰면 hover에 밝기만 4% 낮춥니다.

### 터미널 블록
잉크 바탕, 10px 모서리, 머리 줄(제목 D2Coding 13px 흐린 색 + 조용한 복사 버튼, 아래 잉크 위 선), 본문 D2Coding 14px/1.65. 프롬프트는 노랑, 성공 줄은 밝은 초록, 오류 줄은 밝은 빨강, 출력은 잉크 위 보조 글자. 페이지 바탕이 아니라 블록으로만 어둡습니다.

### 규격서 그림 (Signature)
- **프레임 포맷 그림:** 1.5px 잉크 테두리의 가로 막대를 필드로 나누고(1px 구분선), 위에 D2Coding 눈금. 필드 채움은 태그와 같은 등급 색(노랑·파랑·초록, 색인은 soft 면), 오버헤드와 남은 예산은 빗금. 앱의 에이전트 화면에서는 너비가 토큰 수이고 2px 세로선이 예산이며, 필드에서 꺾인 1px 지시선이 설명을 붙입니다.
- **메시지 시퀀스 차트:** 잉크 테두리 참여자 상자(Conntext만 잉크 채움), 1.5px 진한 선 생명선, 1.5px 화살표와 채운 삼각 화살촉, 응답은 점선. 라벨 태그가 화살표 도착 쪽에 걸립니다.
- **처리 단계 그림:** 칸으로 나뉜 가로 막대, 짝수 칸은 움푹한 면, 칸 사이 채운 삼각 화살촉.

### 알림·빈 상태·토스트
- **알림 띠:** 6px 모서리, soft 면 + 옅은 같은 색 테두리, 아이콘과 제목은 그 색의 ink. 정보(파랑)·주의(주황)·위험(빨강).
- **빈 상태:** 가운데 정렬, 움푹한 면 위 40px 아이콘, 제목 SUIT 700 16px, 설명 42ch, 노랑 주 동작.
- **토스트:** 잉크 바탕, 10px 모서리, 떠 있는 층 그림자, 성공 아이콘은 터미널 초록, 되돌리기 동작은 노랑 버튼.

## Do's and Don'ts

### Do:
- **Do** 노랑 위 글자는 잉크(`--ink`)로, 노랑 글자는 잉크 바탕 위에서만 씁니다.
- **Do** 메모 id는 언제나 등급 라벨 태그로 그리고, 등급을 색과 형태(채움/점선/취소선) 둘 다로 구분합니다.
- **Do** 색은 `base.css` 토큰으로만 씁니다. 그림에는 `--dg-*`, 터미널에는 `--term-*`, 잉크 바탕 영역에는 `.on-ink`를 씁니다.
- **Do** 그림은 규격서 문법으로 그립니다: 1.5px 테두리, 1px 구분선, D2Coding 눈금, 채운 삼각 화살촉.
- **Do** 아이콘은 `icons.svg` 한 벌(24 격자, 선 1.75, 둥근 끝, currentColor)을 쓰고, 없으면 같은 규칙으로 그립니다.
- **Do** 브라우저 기본 표면을 팔레트에 맞춥니다: 선택 색 노랑, 포커스 링 2px 팀 파랑(잉크 위는 노랑), 얇은 스크롤바, 밑줄 띄움 0.22em.
- **Do** 움직임은 `--ease-out`과 120/200/400ms로 짧게 쓰고, `prefers-reduced-motion`에서는 끕니다.

### Don't:
- **Don't** 크림색·종이색 바탕이나 세리프 본문을 쓰지 않습니다.
- **Don't** 페이지 전체를 어두운 화면으로 만들거나 네온 강조색을 쓰지 않습니다. 어두운 면은 레일, 터미널, 토스트, 위 띠에 한정합니다.
- **Don't** 굳은 오프셋 그림자, 굵은 검은 상자로 누른 네오브루탈리즘 표현을 쓰지 않습니다.
- **Don't** `--ink-3`를 본문 글자에 쓰지 않습니다.
- **Don't** D2Coding을 본문이나 제목에 쓰지 않습니다.
- **Don't** 제목 위에 작은 라벨(아이브로)이나 대문자 넓은 자간 라벨을 얹지 않습니다.
- **Don't** 이모지나 유니코드 기호로 아이콘을 대신하지 않습니다.
- **Don't** 심볼의 `nn` 태그를 화면 장식으로 다시 그리지 않습니다. 메모 id 태그(`.tag`)와 모양은 같지만 글자 대신 id를 담습니다.
