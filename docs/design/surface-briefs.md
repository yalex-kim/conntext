# 표면별 브리프 (개발용 문서, 브라우저로 내보내지 않는다)

세계: **케이블 라벨과 프로토콜 규격서.** 연결 엔지니어가 매일 보는 두 가지다. 케이블에 감는 노란 라벨(무엇이 어디로 가는지 적는 표식)과, 규격서의 그림 문법(메시지 시퀀스 차트, 프레임 포맷 그림, 절 번호).

후보로 검토한 것: 주파수 분배 도표, 메시지 시퀀스 차트, 프레임 포맷(비트 필드) 그림, 케이블 라벨·와이어 마커, 실험 노트, RFC 평문, 노선도. 이 범주가 늘 내놓는 것(어두운 터미널 + 네온 강조)과 메모 앱의 기본값(크림색 종이 + 세리프)은 둘 다 피한다.
concept-seed 스크립트는 이 장비에서 실행되지 않았다(바이너리가 CPU에서 죽음). 방향은 위 후보에서 직접 골랐다.

## 소개 페이지 `/` — Persuade

누가 움직여야 하나: 팀 개발자가 플러그인을 설치하고 첫 메모를 적는다.

### Direction contract
THESIS: 페이지 전체가 하나의 메시지 시퀀스 차트다. 스크롤이 곧 시간이고, 노란 라벨(메모)이 에이전트 사이를 건너간다. 거부하는 것: 헤드라인 옆에 제품 화면을 둔 분할 히어로와 그 아래 같은 크기 카드 줄.
OWN-WORLD: 라벨 테이프 노랑이 첫 화면을 차지하고, 그 아래는 차가운 흰 바탕에 잉크색 생명선. 메시지는 등급 색(노랑 메모, 초록 진행 상태, 파랑 팀 지식)의 라벨 태그. 제목은 Paperlogy ExtraBold, 본문은 SUIT, 명령어는 D2Coding.
STORY: 에이전트는 세션마다 잊는다 → 한 줄 적으면 다음 세션이 안다 → 다른 에이전트에서도 이어진다 → 팀이 함께 쓴다 → 설치는 두 줄.
FIRST VIEWPORT: 노란 면 위에 제목 "적어 둔 맥락이 다음 세션으로 이어집니다"가 왼쪽 위에 크게. 오른쪽 아래에 설치 명령과 "웹 열기" 버튼. 노란 면의 아래 가장자리에 참여자 상자 넷(Claude Code, Conntext, OpenCode, 팀 동료)이 걸쳐 있고, 거기서 생명선이 페이지 끝까지 내려간다. 첫 메시지 `/remember`가 화면 아래에 보이기 시작한다.
FORM: 메시지 시퀀스 차트(후보 2번). 서명 동작: 스크롤 위치에 맞춰 메시지 화살표가 그려지고 라벨이 생명선 사이를 이동한다. seed: none (unavailable)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 사용자 매뉴얼 `/manual` — Read

독자의 질문: "어떻게 설치하고, 명령어는 무엇이 있고, 내 메모는 어디로 가나."

### Direction contract
THESIS: 규격서처럼 읽히는 매뉴얼. 절 번호로 가리킬 수 있고("3.2 참고"), 그림은 규격서의 그림 문법을 쓴다. 거부하는 것: 카드 격자로 된 도움말 센터.
OWN-WORLD: 왼쪽에 잉크색 목차 레일과 노란 conn 라벨, 본문은 흰 바탕의 차분한 단. 절 번호는 D2Coding 숫자, 명령어는 터미널 블록, 등급은 앱과 같은 라벨 태그.
STORY: 설치 → 다섯 명령어 → 메모가 처리되는 과정 → 등급과 주입 → 팀 공유 → 기록 끄기와 삭제 → 문제 해결.
FIRST VIEWPORT: 왼쪽 레일에 목차(현재 절 표시), 오른쪽 단 맨 위에 제목과 "5분 설치" 절이 바로 시작한다. 첫 화면 안에 설치 명령 블록이 보인다.
FORM: 기술 규격서(후보 3·6번의 문법). 서명 동작: 절 번호 체계와 프레임 포맷 그림. seed: none (unavailable)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 웹 앱 `/app` — Operate

과업: 저장된 것을 확인하고, 틀린 것을 고치고, 팀에 올리고, 에이전트가 무엇을 받는지 본다. 하루에 몇 번, 짧게.

### Direction contract
THESIS: 익숙한 작업 도구의 뼈대(왼쪽 레일, 목록과 상세)에, 등급을 라벨 태그로 읽게 하는 것 하나를 더한다. 거부하는 것: 회색 화면에 강조색 하나, 숫자 타일을 늘어놓은 대시보드.
OWN-WORLD: 잉크색 레일, 차가운 밝은 바탕. 메모 id는 와이어 마커처럼 생긴 라벨 태그이고 등급이 색과 형태로 구분된다(직접 적은 메모는 노란 채움, 팀 지식은 파란 채움, 세션 추출 후보는 점선 테두리, 진행 상태는 초록 채움, 대체됨은 취소선).
STORY: 무엇이 저장됐나 → 어디에 들어갔나 → 에이전트가 무엇을 받나 → 틀리면 되돌린다.
FIRST VIEWPORT: 왼쪽 레일(공간 전환, 홈·위키·메모·에이전트·세션·설정·운영), 위쪽에 메모 입력 겸 검색, 본문에 "이어서 할 일"과 "최근 저장 내역".
FORM: 표준 웹 앱 셸. 서명 동작: 에이전트 화면의 주입 내용을 프레임 포맷 그림으로 그린다(구역이 필드, 너비가 토큰 수, 눈금이 예산). seed: none (unavailable)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
