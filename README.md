# Conntext

Connectivity 팀의 코딩 에이전트 메모리 서비스(PoC)입니다. 개발자가 Claude Code나 OpenCode에서 적어 둔 메모와 진행 상태가 다음 세션과 다른 에이전트로 이어집니다. 사내 RAG 채팅 connpass 같은 다른 서비스도 같은 API로 세션을 보낼 수 있습니다.

중심은 사람이 직접 적은 메모입니다. 메모는 원문 그대로 저장되고, 신뢰 등급에 따라 에이전트에 다르게 쓰입니다. 직접 적은 메모(`mine`)는 사실로 다루고, 지시·선호로 분류된 것은 매 세션 시작 때 들어갑니다. 팀 공간에 올린 메모(`team`)는 작성자와 함께 보입니다. 세션이 끝나면 서버가 대화록에서 진행 상태(`state`, 14일 뒤 만료)와 지식 후보(`candidate`, 미확인)를 뽑습니다. 후보는 사람이 확인하거나 답에 두 번 쓰여야 정식 메모가 되고, 그 전에는 "미확인"으로 표시됩니다. 세션 자동 수집은 메모를 보조하는 수단이지 중심이 아닙니다.

공간은 개인 공간 하나와 소속 팀 공간들로 나뉩니다. 개인 메모를 팀으로 올리면 출처가 붙은 복사본이 팀 공간에 생기고 원본은 남습니다. 운영자는 정책, 비용, 품질 지표, 감사 로그를 보고, 개인 공간의 내용은 사유를 남기는 예외 열람으로만 봅니다.

## 5분 안에 띄우기

요구 사항: Python 3(3.12에서 시험했습니다. 표준 라이브러리만 쓰므로 pip 설치는 필요 없습니다), git.

```sh
cd server
python3 -m conntext serve --demo      # DB가 비어 있으면 합성 데모 데이터를 넣고 시작
```

```
[conntext] 데모 데이터 준비 완료: 사용자 5명, 메모 46건, 주제 32개 (LLM: heuristic)
[conntext] 로그인 예: dohyun@conn.example(개발자) · seoyun@conn.example(운영자) · eunho@conn.example(감사자)
[conntext] http://0.0.0.0:7373  ·  LLM: heuristic (규칙 기반)  ·  DB: /…/conntext/data/conntext.db
[conntext] 개발용 로그인이 켜져 있습니다(CONNTEXT_DEV_LOGIN=1). 사내 망 밖에 노출하지 마세요.
```

- DB는 기본으로 `data/conntext.db`에 생깁니다. 데모 데이터를 처음부터 다시 만들려면 `python3 -m conntext seed --reset`(기존 DB를 지웁니다).
- `--demo` 없이 빈 DB로 시작하면 운영자 계정 하나(`CONNTEXT_ADMIN_EMAIL`, 기본 `admin@conn.example`)만 만들어집니다.
- 웹: `http://localhost:7373/`(소개), `/manual`(매뉴얼), `/app`(앱). 화면 파일은 `web/`에 있고 서버가 정적 파일로 제공합니다.
- 데모 로그인: 개발용 로그인이라 이메일만으로 들어갑니다. 웹 로그인 화면에서 사용자를 고르거나 API로 받습니다.

```sh
curl -s localhost:7373/api/dev-users                       # 로그인 가능한 사용자 목록
curl -s -X POST localhost:7373/api/login -H 'Content-Type: application/json' \
     -d '{"email":"dohyun@conn.example"}'                   # {"token": "ctx_…"} (웹 세션 토큰)
```

데모 사용자: 한서윤(`seoyun@`, 운영자), 정도현(`dohyun@`, 개발자), 오지민(`jimin@`), 윤태경(`taekyung@`), 배은호(`eunho@`, 감사자). 모두 `@conn.example`이고 Connectivity 팀 공간이 있습니다.

## 에이전트 연결

### 1. 클라이언트 토큰 발급

웹 앱의 설정 > 연결에서 발급하거나, 서버 장비에서 CLI로 발급합니다. 사용자가 DB에 있어야 합니다.

```sh
cd server && python3 -m conntext token dohyun@conn.example --label 노트북
```

웹 세션 토큰으로 API를 불러도 됩니다: `POST /api/tokens` 본문 `{"label":"노트북"}`.

### 2. Claude Code

저장소 최상위가 플러그인 마켓플레이스입니다(`.claude-plugin/marketplace.json`, 플러그인은 `plugin/`).

```
/plugin marketplace add /path/to/conntext         # 또는 이 저장소의 git 주소
/plugin install conntext@conntext
```

터미널에서는 `claude plugin marketplace add /path/to/conntext`, `claude plugin install conntext@conntext`로도 됩니다. 설치 뒤 서버 주소와 토큰을 저장합니다. 설정은 `~/.conntext/config.json`에 저장되고 모든 클라이언트 사본이 함께 씁니다.

```sh
python3 /path/to/conntext/plugin/scripts/conntext.py setup --url http://서버:7373 --token ctx_…
python3 /path/to/conntext/plugin/scripts/conntext.py status
```

```
연결됨: http://서버:7373
사용자: 정도현 <dohyun@conn.example>
팀: Connectivity 팀
이 폴더의 저장소: git@github.com:connectivity/ble-gateway.git
세션 기록: 켜짐
```

플러그인이 하는 일:

- 훅: `SessionStart`에서 맥락(지시·선호, 팀 규칙, 이 저장소의 진행 상태, 절차 색인, 주제 색인)을 넣고, `PreCompact`와 `SessionEnd`에서 대화록을 백그라운드로 올립니다. `UserPromptSubmit`(질문을 보낼 때)에서는 그 질문과 관련도가 충분한 메모만 최대 3개를 질문 맥락에 넣습니다(없으면 아무것도 넣지 않음, 2.5초 안에 답이 없으면 건너뜀). `Stop`(응답 한 번이 끝날 때)에서는 턴을 세어, 정책의 `checkpoint_turns`(기본 10)마다 대화 중 체크포인트를 올립니다. 훅은 에이전트를 기다리게 하지 않고, 실패하면 조용히 끝나며 `~/.conntext/client.log`에 남깁니다.
- MCP: `conntext.py mcp`가 표준 입출력 MCP를 서버의 `/mcp`로 중계하고, 도구 호출에 현재 저장소(`git remote origin`)를 `project`로 채워 넣습니다.
- 명령어 다섯 개:

| 명령어 | 하는 일 |
|---|---|
| `/conntext:remember` | 메모 저장. 저장 결과(분류, 주제, 대체한 메모)를 한 줄로 보여 줍니다 |
| `/conntext:recall` | 내 메모와 팀 지식에서 찾아 답합니다. 근거에 `m:번호`와 등급을 붙입니다 |
| `/conntext:resume` | 이 저장소의 지난 진행 상태를 가져와 이어서 시작합니다 |
| `/conntext:handoff` | 지금까지의 진행 상태를 저장해 다음 세션이나 다른 에이전트가 이어받게 합니다 |
| `/conntext:forget` | 메모를 지우거나 방금 한 저장을 되돌립니다 |

### 3. OpenCode

```sh
python3 /path/to/conntext/plugin/scripts/conntext.py install opencode
```

`~/.conntext/bin/conntext.py`에 클라이언트를 복사하고, OpenCode 설정 폴더(`OPENCODE_CONFIG_DIR`, 없으면 `~/.config/opencode`)에 플러그인(`plugins/conntext.js`), 명령어 다섯 개(`commands/*.md`, 이름은 `/remember`, `/recall`, `/resume`, `/handoff`, `/forget`), `opencode.json`의 `mcp.conntext` 항목을 넣습니다. 기존 `opencode.json`은 `opencode.json.conntext-backup`으로 남깁니다. OpenCode를 다시 시작하면 적용됩니다.

OpenCode에는 세션 종료 이벤트가 없습니다. 플러그인은 응답이 끝날 때(`session.idle`)마다 대화 스냅샷을 `~/.conntext/pending/`에 쓰고, OpenCode와 분리된 대기 프로세스를 띄웁니다. 대기 프로세스는 OpenCode가 끝나면 곧바로, OpenCode가 켜져 있으면 마지막 응답 뒤 300초(`CONNTEXT_IDLE_UPLOAD_SECONDS`) 동안 대화가 없을 때 올립니다. 세션마다 대기 프로세스는 하나만 남습니다. 질문마다 넣는 메모는 `chat.message`에서 질문을 받아 서버에 묻고, 그 질문의 모델 호출들(`experimental.chat.system.transform`)에 결과를 덧붙입니다. `chat.message`가 질문 내용을 주지 않는 OpenCode 판(1.4.3, parts가 빈 배열)에서는 세션의 마지막 사용자 메시지를 읽어 씁니다. 이 경로는 가짜 OpenCode 클라이언트로만 시험했고 OpenCode를 실제로 띄워 보지는 못했습니다.

### 저장소 없이 받기

서버가 `/client/conntext.py`로 클라이언트를 배포합니다. 받은 단일 파일로 `install opencode`를 실행하면 플러그인과 명령어 파일도 서버(`/client/opencode/conntext.js`, `/client/skills/<이름>.md`)에서 받습니다.

```sh
mkdir -p ~/.conntext/bin && curl -fsSL http://서버:7373/client/conntext.py -o ~/.conntext/bin/conntext.py && python3 ~/.conntext/bin/conntext.py setup --url http://서버:7373 --token ctx_…
python3 ~/.conntext/bin/conntext.py install opencode
```

Claude Code 플러그인(훅과 명령어)은 마켓플레이스로 설치해야 합니다. 받은 파일만으로는 Claude Code 훅이 등록되지 않습니다.

## 설정

서버는 환경 변수로 설정합니다(`server/conntext/config.py`).

| 변수 | 기본값 | 설명 |
|---|---|---|
| `CONNTEXT_HOST` | `0.0.0.0` | 바인드 주소 (`serve --host`로도 지정) |
| `CONNTEXT_PORT` | `7373` | 포트 (`serve --port`로도 지정) |
| `CONNTEXT_DATA` | `<저장소>/data` | 데이터 폴더 |
| `CONNTEXT_DB` | `$CONNTEXT_DATA/conntext.db` | SQLite 파일 경로 |
| `CONNTEXT_PUBLIC_URL` | `http://localhost:<포트>` | 사용자에게 보여 줄 서버 주소(`/api/me`의 `public_url`) |
| `CONNTEXT_DEV_LOGIN` | `1` | `1`이면 이메일만으로 로그인. `0`이면 로그인 API가 막힙니다 |
| `CONNTEXT_ADMIN_EMAIL` | `admin@conn.example` | 빈 DB로 처음 띄울 때 만드는 운영자 계정 |
| `CONNTEXT_LLM` | `auto` | `auto`, `anthropic`, `openai`, `claude-cli`, `heuristic` |
| `CONNTEXT_LLM_MODEL` | 공급자별 | 모델 이름. anthropic 기본은 `claude-opus-5-5` |
| `CONNTEXT_LLM_BASE_URL` | 없음 | OpenAI 호환 엔드포인트 (예: `http://llm.사내/v1`) |
| `CONNTEXT_LLM_API_KEY` | 없음 | OpenAI 호환 엔드포인트 키 |
| `CONNTEXT_LLM_TIMEOUT` | `60` | LLM 호출 제한 시간(초) |
| `CONNTEXT_EMBED` | `local` | `local`(문자 n-gram 해싱) 또는 `openai`(호환 엔드포인트) |
| `CONNTEXT_EMBED_BASE_URL` | 없음 | 임베딩 엔드포인트 (`/embeddings`를 붙여 부릅니다) |
| `CONNTEXT_EMBED_MODEL` | 없음 | 임베딩 모델 |
| `CONNTEXT_EMBED_API_KEY` | 없음 | 임베딩 엔드포인트 키 |
| `ANTHROPIC_API_KEY` | 없음 | 있으면 `auto`가 anthropic을 고릅니다 |

클라이언트(`conntext.py`, OpenCode 플러그인)가 읽는 변수:

| 변수 | 설명 |
|---|---|
| `CONNTEXT_HOME` | 클라이언트 폴더. 기본 `~/.conntext` (설정, 대기 중 업로드, 로그) |
| `CONNTEXT_URL`, `CONNTEXT_TOKEN` | `config.json` 대신 쓸 서버 주소와 토큰 |
| `CONNTEXT_OFF` | `1`이면 훅이 아무것도 하지 않고, MCP 프록시가 저장소를 채우지 않습니다 |
| `CONNTEXT_PLATFORM` | 서버에 알릴 플랫폼 이름(OpenCode 설치 시 `opencode`로 넣습니다) |
| `CONNTEXT_IDLE_UPLOAD_SECONDS` | OpenCode를 켜 둔 채 쉴 때 업로드까지 기다리는 시간. 기본 300 |
| `CONNTEXT_PROMPT_TIMEOUT` | 질문마다 관련 메모를 기다리는 최대 시간(초). 기본 2.5. 넘으면 아무것도 넣지 않고 질문을 그대로 보냅니다 |

### LLM 공급자

LLM은 메모 분류·관계 판정, 주제 문서 본문, 세션 추출에 씁니다. 어떤 공급자든 호출이 실패하면 그 건은 규칙 기반으로 처리합니다. 사용자의 최근 24시간 LLM 토큰 사용량이 예산(정책 `budget`)을 넘으면, 사용량이 다시 예산 아래로 내려갈 때까지 그 사용자의 메모는 규칙 기반으로 처리합니다. 넘었을 때의 동작은 이것 하나뿐이고 설정으로 바꿀 수 없습니다. 현재 공급자는 서버 시작 줄과 `GET /api/health`의 `llm`에 나옵니다.

| 공급자 | 켜는 법 | 비고 |
|---|---|---|
| anthropic | `ANTHROPIC_API_KEY=…` (`CONNTEXT_LLM=auto`면 자동 선택) | SDK 없이 HTTP로 Messages API를 부릅니다 |
| OpenAI 호환(사내 모델) | `CONNTEXT_LLM_BASE_URL=http://…/v1 CONNTEXT_LLM_MODEL=… [CONNTEXT_LLM_API_KEY=…]` | `auto`에서 키가 없고 BASE_URL이 있으면 선택. `/chat/completions`, `response_format: json_object` |
| claude-cli | `CONNTEXT_LLM=claude-cli` | 서버 장비의 로그인된 `claude -p`를 부릅니다. 키 없이 프롬프트를 시험할 때 씁니다. CLI가 매번 읽는 자체 시스템 문맥(캐시 읽기)은 세지 않으므로 입력 토큰 수치는 근사값입니다 |
| 규칙 기반 | 아무것도 설정하지 않거나 `CONNTEXT_LLM=heuristic` | 외부 호출 없음 |

### 임베딩 공급자

기본(`local`)은 외부 호출 없이 문자 2·3-gram과 단어를 512차원으로 해싱합니다. 사내 임베딩 서버를 쓰려면 `CONNTEXT_EMBED=openai`와 `CONNTEXT_EMBED_BASE_URL`, `CONNTEXT_EMBED_MODEL`을 지정합니다. 호출이 실패하면 그 건은 `local`로 계산합니다. 공급자를 바꾸면 기존 메모의 벡터와 차원이 달라 검색에 잡히지 않으므로, 운영자가 `POST /api/admin/pipeline/reprocess` 본문 `{"scope":"all"}`로 다시 계산해야 합니다.

## 구조

```
server/conntext/     서버 (Python 표준 라이브러리, SQLite)
  __main__.py        CLI: serve, seed, token
  config.py          환경 변수 설정
  api.py             HTTP 서버: 웹 API, 훅 수신, /mcp, /client/ 배포, 정적 파일
  mcp.py             MCP 도구(remember, recall, search_sessions, get_memos, get_topic, resume, handoff, forget, mark_used)
  pipeline.py        메모 저장 파이프라인, 주제 문서, 팀 승격, 되돌리기
  retrieval.py       검색(recall), 세션 시작 맥락 구성, 진행 상태 조회
  sessions.py        세션 수집, 대화록 축약, 진행 상태·지식 후보 추출, 보존 기간 정리
  llm.py             LLM 공급자와 프롬프트
  embed.py           임베딩
  masking.py         저장 전 마스킹(<private> 태그, 비밀값 정규식)
  access.py          공간 접근 제어
  admin.py           운영: 사용자, 팀, 퇴사 처리, 재처리, 감사, 신고, 예외 열람
  jobs.py            SQLite 작업 대기열과 워커 스레드
  db.py, schema.sql  SQLite 접근 계층, 스키마, 기본 정책
  seed.py            합성 데모 데이터
plugin/              Claude Code 플러그인 (hooks, .mcp.json, skills 5개, scripts/conntext.py)
opencode/conntext.js OpenCode 플러그인
web/                 웹 화면 (정적 파일)
tests/               unittest
data/                기본 DB 위치
```

`plugin/scripts/conntext.py` 하나가 훅, stdio MCP 프록시, 업로드, OpenCode 설치를 맡는 클라이언트입니다. 표준 라이브러리만 씁니다.

### 데이터 모델

- `users`(역할: `user`, `operator`, `auditor`), `spaces`(`personal` 또는 `team`), `space_members`(팀 안 역할: `member`, `admin`), `tokens`(SHA-256 해시만 저장, `client`/`web`).
- `memos`: 본문, 종류(`instruction` 지시·선호, `knowledge` 지식, `procedure` 절차, `state` 진행 상태), 절차의 `when_hint`(언제 쓰는지 한 줄), 출처(`manual`, `session`, `import`, `promoted`), 신뢰(`high`, `low`=세션 후보, `temp`=진행 상태), 범위(`global` 또는 저장소별 `project`와 `project_key`), 상태(`active`, `superseded`, `duplicate`, `deleted`, `expired`, `dismissed`), 임베딩, 원본 권한 라벨 `source_acl`.
- `topics`와 `memo_topics`: 메모가 모이는 주제(위키) 문서. 본문은 메모로부터 생성합니다.
- `links`(대체·중복·보충·관련), `entities`(사람, 시스템, 용어).
- `sessions`: 에이전트 세션. 원본 JSONL이 아니라 발화와 도구 이름만 남긴 축약 대화록을 저장합니다. 상태 `open` → `uploaded` → `extracted` (또는 `excluded`).
- `injections`, `memo_uses`: 어떤 메모가 언제 에이전트에 들어갔고 쓰였는지.
- `audit_log`, `metrics`, `trace`, `jobs`, `policies`, `reports`, `notifications`, `ingest_events`(되돌리기용).

`project_key`는 git 원격 주소를 정규화한 값입니다. `git@github.com:Org/Repo.git`과 `https://github.com/org/repo`는 모두 `github.com/org/repo`가 됩니다.

### 메모가 저장될 때 거치는 단계

`remember`(MCP 도구, 웹, 세션 추출 모두 같은 함수)는 다음 순서로 처리합니다.

1. 마스킹: `<private>…</private>`를 지우고 정책 `masking_rules`의 정규식(키, 토큰, 비밀번호 대입, 주민번호, 휴대전화 번호 등)을 가립니다. 이 단계를 거친 본문만 DB에 닿습니다.
2. 저장: 원문 그대로 저장하고 임베딩과 전문 검색 색인(FTS5 trigram)을 만듭니다.
3. 분석: 같은 공간에서 비슷한 메모와 기존 주제 목록을 함께 LLM(또는 규칙)에 넘겨 종류, 제목, 개체, 가장 가까운 메모와의 관계(`duplicate`, `update`, `supplement`, `related`, `none`), 주제를 정합니다. 후보 메모는 LLM에는 유사도 컷 없이 검색 상위 5개에 같은 저장소의 최근 메모를 더해 최대 8개를 넘기고, 규칙 경로에는 유사도 0.1 이상인 상위 5개만 씁니다.
4. 적용: 중복이면 기존 메모에 합치고, 갱신이면 기존 메모를 `superseded`로 돌리고, 보충이면 같은 주제에 붙입니다. 세션 후보(`low`)는 사람이 적은 메모를 대체하지 못하고 보충으로 낮춰집니다. 지식이면 지식 문서에, 절차면 절차 문서에 넣고(없으면 새로 만들고, 두 종류의 문서는 섞지 않습니다), 진행 상태면 보존 기간(기본 14일)을 붙입니다. 절차에는 언제 쓰는지 한 줄(`when_hint`)이 붙고, 세션 시작 때는 `- 언제 → 절차 제목 [t:N]`만 절차 색인으로 들어갑니다. 에이전트는 그 작업을 할 때 `get_topic`으로 본문을 꺼내 따릅니다.
5. 주제 문서 갱신: 바뀐 주제를 작업 대기열에 넣고, 워커가 본문을 다시 만듭니다.
6. 결과: 사람이 읽는 한 줄(`저장됨 m:… → [주제] · 종류 · 범위`)과 되돌리기용 이벤트를 돌려줍니다.

자동 분류된 종류가 틀렸으면 `PUT /api/memos/<id>`에 본문 없이 `{"kind": "knowledge"}`처럼 종류만 보내 제자리에서 바꿉니다. 지식이나 절차가 되면 그 종류의 주제 문서로 옮겨지고, 지시나 진행 상태가 되면 주제에서 빠집니다. 절차의 '언제 쓰는지'는 `{"when": "스테이징에 배포할 때"}`로 제자리에서 고칩니다(되돌릴 수 있음). 진행 상태가 되면 보존 기간이 붙고, 진행 상태에서 벗어나면 없어집니다. 이 변경도 되돌리기 내역에 남습니다. 본문 `text`를 보내면 지금처럼 새 판을 만들어 이전 판을 대체합니다.

세션 대화록은 업로드 → 마스킹과 축약 → 작업 대기열 → 추출(요약, 진행 상태, 지식 후보 최대 5개) 순서로 처리됩니다. 진행 상태는 저장소마다 최신 하나만 유효합니다.

긴 세션은 끝나기 전에도 N턴마다 체크포인트로 올라옵니다(작업 `session_checkpoint`, 비용 단계도 따로 집계). 추출은 매번 **직전 추출 이후 부분만** 봅니다. 진행 상태는 이전 상태를 받아 세션 전체 기준으로 다시 쓰고(다른 에이전트의 `/resume`에 바로 반영), 지식 후보는 새 부분에서만, 앞서 뽑은 후보를 알려 준 채로 뽑습니다. 어디까지 추출했는지는 `sessions.extracted_tail`(대화록 끝 200자)로 기억하고, 찾지 못하면 전체를 다시 봅니다. OpenCode처럼 같은 세션이 여러 번 올라오는 경우도 같은 방식이라 후보가 되풀이되지 않습니다.

## 다른 서비스에서 붙기

### 세션 보내기 (connpass 같은 사내 RAG 채팅)

사용자 본인의 클라이언트 토큰으로 `POST /api/hooks/session-upload`를 부릅니다. `messages`는 `{role: "user"|"assistant", text, tools?}` 목록입니다. `source_acl`에는 답의 근거가 된 원본 문서의 권한 라벨을 넣으면 세션과 그 세션에서 뽑힌 후보 메모에 그대로 붙습니다. 플랫폼 이름은 정책 `capture.platforms`(기본 `claude-code`, `opencode`, `connpass`)에 있어야 수집됩니다. 같은 `session_id`로 다시 보내면 덮어씁니다.

```sh
curl -s -X POST http://서버:7373/api/hooks/session-upload \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"platform":"connpass","session_id":"chat-20261112-001",
       "project":"git@github.com:connectivity/ota-service.git",
       "messages":[{"role":"user","text":"OTA 청크 크기가 왜 244바이트야?"},
                   {"role":"assistant","text":"MTU 247에서 ATT 헤더 3바이트를 뺀 값이기 때문입니다."}],
       "source_acl":["confluence:CONN","team:connectivity"]}'
# {"session_id": 5, "status": "uploaded", "masked": 0}
```

`project`는 선택입니다. `final: false`를 넣으면 저장만 하고 추출하지 않습니다(중간 저장). `messages` 대신 `transcript`(Claude Code JSONL 또는 일반 텍스트)를 보내도 됩니다.

### MCP에 직접 붙기

`/mcp`는 JSON-RPC over HTTP POST(스트리밍 없음)입니다. `Authorization: Bearer <클라이언트 토큰>`이 필요합니다. 저장소 범위가 필요한 도구에는 `project`를 직접 넣습니다.

```sh
curl -s -X POST http://서버:7373/mcp -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recall",
       "arguments":{"query":"OTA 청크 크기","project":"github.com/connectivity/ota-service"}}}'
```

HTTP MCP를 지원하는 에이전트라면 `url: http://서버:7373/mcp`와 `Authorization` 헤더로 등록할 수 있습니다. 이 경우 `project`는 에이전트가 채워야 하고, 세션 훅(맥락 주입, 대화록 업로드)은 동작하지 않습니다.

## 운영

### 역할

| 역할 | 할 수 있는 일 |
|---|---|
| `user` | 자기 공간과 소속 팀 공간 |
| 팀 `admin` | 팀 공간의 다른 사람 메모 수정, 팀 신고 처리 |
| `operator` | 사용자·팀 관리, 정책, 재처리, 감사 로그, 신고, 예외 열람 (`/api/admin/*`) |
| `auditor` | 현황, 정책, 감사 로그 열람만 |

사용자 추가와 팀 배정(운영자 토큰):

```sh
curl -s -X POST $S/api/admin/users -H "$H" -H 'Content-Type: application/json' -d '{"email":"newdev@conn.example","name":"신입","role":"user"}'
curl -s -X PUT  $S/api/admin/teams/<팀 id>/members -H "$H" -H 'Content-Type: application/json' -d '{"user_id":6,"role":"member"}'
```

퇴사·이동: `POST /api/admin/users/<id>/offboard` 본문 `{"personal":"delete"|"keep","reassign_to":<사용자 id>}`. 토큰을 모두 회수하고, 개인 공간을 지우거나 남기고, 팀 메모의 작성자를 넘깁니다. 처리 전에 `GET /api/admin/users`의 `team_memos_authored`(넘겨줄 팀 메모 수)와 `personal_memos_to_delete`(개인 공간에서 지워질 메모 수, 상태 무관)로 영향을 미리 볼 수 있습니다.

### 정책

`GET /api/admin/policies`, `PUT /api/admin/policies/<키>` 본문 `{"value": …}`. 객체 정책은 주어진 필드만 바뀝니다.

| 키 | 기본값 |
|---|---|
| `masking_rules` | 마스킹 정규식 목록(`{name, pattern}`) |
| `capture` | `platforms`, `excluded_projects`(부분 문자열 일치), `max_transcript_chars` 400000, `checkpoint_turns` 10(0이면 대화 중 체크포인트를 끔. 클라이언트는 세션 시작 응답으로 이 값을 받는다) |
| `retention` | 대화록 90일(에이전트의 `search_sessions` 검색 대상), 쓰이지 않은 후보 30일, 진행 상태 14일, 후보 자동 승격 사용 횟수 2 |
| `injection` | 세션 시작 맥락 토큰 예산 1500, 지시 최대 12개·1,200자, 절차 색인 최대 20개, 주제 최대 40개(색인은 제목만 넣으므로 보통 예산이 먼저 개수를 정한다) |
| `prompt_recall` | 질문마다 관련 메모: `enabled` 켬, `max_memos` 3, `token_budget` 400, `min_score` 0.35. 질문의 내용어가 메모에 둘 이상 있어야 하고(키워드 일치), 관련도 = 0.6×내용어 일치 비율 + 0.4×검색 점수가 기준 이상이어야 한다. 사용자는 웹 에이전트 화면에서 끈다(`users.prompt_recall_off`) |
| `budget` | 사용자별 최근 24시간 LLM 토큰 400000. 넘으면 규칙 기반으로 처리 |
| `clients` | 최소 플러그인 버전 |

예: 특정 저장소를 수집에서 빼기

```sh
curl -s -X PUT $S/api/admin/policies/capture -H "$H" -H 'Content-Type: application/json' \
     -d '{"value":{"excluded_projects":["github.com/connectivity/secret-repo"]}}'
```

### 기록을 끄는 세 가지 방법

| 방법 | 범위 | 동작 |
|---|---|---|
| `conntext.py pause` (`unpause`로 해제) | 이 장비 | 대화록을 올리지 않습니다. 세션 시작 때는 맥락 조회용 저장소 식별자만 보내고 세션 id와 경로는 보내지 않습니다. 메모 저장·조회는 그대로 됩니다 |
| `CONNTEXT_OFF=1` 또는 저장소 최상위의 `.conntext-off` 파일 | 프로세스 또는 저장소 | 훅이 서버와 통신하지 않습니다(맥락 주입도 없음). MCP 프록시는 저장소를 채우지 않습니다 |
| 웹 설정 또는 `PUT /api/me` `{"capture_paused": true}` | 계정 | 서버가 올라온 대화록을 저장하지 않고 세션을 `excluded`로 표시합니다 |

메모 본문이나 대화 안의 `<private>…</private>`는 장비를 떠나기 전에 클라이언트가 지우고, 서버도 저장 전에 한 번 더 지웁니다.

### 데이터 삭제

- 내 데이터 전부: `DELETE /api/me/data` 본문 `{"confirm":"<본인 이메일>"}`. 개인 공간의 메모, 주제, 세션, 사용 기록을 실제로 지웁니다. 팀에 올린 복사본은 팀의 것이라 남습니다.
- 세션 하나: `DELETE /api/sessions/<id>`. 그 세션에서 나온 미확인 후보와 진행 상태도 지웁니다.
- 메모 삭제(`forget`)는 7일 동안 되돌릴 수 있고, 그 뒤 워커가 본문을 지웁니다.
- 내보내기: `GET /api/export`.

### 예외 열람

운영자가 개인 공간의 내용을 봐야 할 때만 씁니다. 사유는 10자 이상이어야 하고, 감사 로그에 남으며, 당사자에게 알림이 갑니다.

```sh
curl -s -X POST $S/api/admin/breakglass -H "$H" -H 'Content-Type: application/json' \
     -d '{"user_id":2,"reason":"장애 조사로 게이트웨이 메모 확인 필요","memo_id":7}'
```

감사 로그: `GET /api/admin/audit?action=&actor_id=&limit=&before=`. 최신순이고, 응답의 `next_before`를 `before`로 넘기면 더 오래된 기록이 옵니다. 권한 거부(공간 읽기, 팀 관리자, 운영 전용 API)는 `access_denied`로 남습니다. 운영 현황(지연, LLM 호출·비용, 대기열): `GET /api/admin/overview`.

## 테스트

```sh
python3 -m unittest discover -s tests          # 저장소 최상위에서
```

- `tests/test_conntext.py`: 서버(마스킹, 저장 파이프라인, 검색, 세션 추출, 권한, API, MCP).
- `tests/test_client.py`: 클라이언트를 실제 프로세스로 실행합니다. 임시 DB와 임시 포트의 서버, 임시 `CONNTEXT_HOME`과 OpenCode 설정 폴더를 써서 사용자의 실제 설정을 건드리지 않습니다.

테스트는 LLM 없이(규칙 기반) 돕니다. 실행에 40초쯤 걸립니다.

## PoC의 한계

코드로 확인한 것입니다.

- 인증: 개발용 로그인(이메일만 입력)뿐이고 사내 SSO 연동이 없습니다. `CONNTEXT_DEV_LOGIN=1`일 때 `/api/dev-users`는 인증 없이 사용자 목록을 돌려줍니다. 토큰에 만료가 없고 회수만 됩니다.
- 전송: 서버는 HTTP만 받습니다. TLS는 앞단 프록시가 맡아야 합니다.
- 검색: 기본 임베딩이 문자 n-gram 해싱이라 의미 검색이 아니라 표기가 겹치는 정도를 봅니다. 같은 뜻을 다른 말로 물으면 놓칩니다. 질문마다 넣는 메모(#12)는 이 때문에 내용어가 겹쳐야만 넣도록 보수적으로 잡았습니다. 사내 임베딩을 붙이면 `prompt_recall.min_score`를 다시 맞춰야 합니다.
- 규모: 검색할 때마다 대상 공간의 메모 전체를 읽어 파이썬에서 유사도를 계산합니다. 메모가 수천 건을 넘으면 느려집니다.
- 품질: LLM 없이(규칙 기반) 돌면 종류 분류, 관계 판정, 주제 제목, 세션 추출의 품질이 낮습니다. 데모 데이터도 규칙 기반으로 만들어졌습니다.
- Anthropic API 경로는 키가 없어 실제 호출로 검증하지 못했습니다.
- 서버는 단일 프로세스, 단일 SQLite 파일이고 작업 워커도 같은 프로세스의 스레드 하나입니다. 여러 대로 늘릴 수 없습니다.
- 웹소켓이나 서버 푸시가 없습니다. 웹은 새로 불러와야 바뀐 내용을 봅니다.
- 세션 업로드가 실패하면(서버가 꺼져 있는 등) 클라이언트는 대화록 표시를 남겨 두고, 6시간이 지난 뒤 다음 세션 시작 때 다시 올립니다. 그 전에는 이어받을 수 없습니다. OpenCode 대기 프로세스는 실패 직후 두 번(10초, 30초 뒤) 더 시도합니다.
- OpenCode를 켜 둔 채 Claude Code로 넘어가면 대화가 올라가기까지 최대 300초가 걸립니다(`CONNTEXT_IDLE_UPLOAD_SECONDS`). OpenCode를 끄면 바로 올라갑니다.
- 클라이언트는 Linux에서만 시험했습니다. Windows 분기(분리 프로세스, 프로세스 확인)는 코드만 있고 실행해 보지 않았습니다.
