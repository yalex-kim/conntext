"""LLM 호출 계층.

단계(stage)마다 JSON 하나를 돌려받는 단일 호출만 쓴다. 공급자는 네 가지다.

- anthropic   : Claude Messages API. 이 서버는 표준 라이브러리만 쓰는 것이 제약이라
                (호스트에 pip가 없다) SDK 대신 HTTP로 직접 호출한다.
- openai      : OpenAI 호환 엔드포인트. 사내 모델 서빙용.
- claude-cli  : 로컬 `claude -p`. 키 없이 프롬프트를 검증할 때 쓴다.
- heuristic   : LLM 없이 규칙으로 처리. None을 돌려주면 호출부가 규칙 경로를 탄다.

호출마다 지연 시간과 토큰을 metrics에 남긴다. 운영 화면의 비용 지표가 여기서 나온다.
"""
import json, os, re, subprocess, time, urllib.error, urllib.request
from . import config, db

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2026-10-21"
DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"


def provider():
    p = config.LLM_PROVIDER
    if p != "auto":
        return p
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if config.LLM_BASE_URL:
        return "openai"
    return "heuristic"


def model_name():
    p = provider()
    if p == "anthropic":
        return config.LLM_MODEL or DEFAULT_ANTHROPIC_MODEL
    if p == "heuristic":
        return "규칙 기반"
    return config.LLM_MODEL or p


def _over_budget(user_id):
    if not user_id:
        return False
    b = db.policy("budget")
    limit = db.val("SELECT llm_budget_tokens FROM users WHERE id=?", user_id) or b.get("daily_tokens_per_user") or 0
    if not limit:
        return False
    since = db.now() - 86400
    used = db.val("SELECT SUM(tokens_in+tokens_out) FROM metrics WHERE kind='llm' AND user_id=? AND created_at>=?",
                  user_id, since, default=0)
    return used >= limit


def complete_json(stage, system, user, schema, user_id=None):
    """JSON 객체를 돌려준다. 규칙 경로로 가야 하면 None."""
    p = provider()
    if p == "heuristic":
        return None
    if _over_budget(user_id):
        db.metric("llm", stage + ":budget_exceeded", 0, user_id=user_id, ok=False)
        return None
    t0 = time.time()
    try:
        if p == "anthropic":
            out, tin, tout = _anthropic(system, user, schema)
        elif p == "openai":
            out, tin, tout = _openai(system, user, schema)
        elif p == "claude-cli":
            out, tin, tout = _claude_cli(system, user, schema)
        else:
            return None
    except Exception as e:  # 어떤 실패든 규칙 경로로 내려가고, 실패는 지표로 남긴다.
        db.metric("llm", stage, (time.time() - t0) * 1000, user_id=user_id, ok=False)
        db.trace("llm_error", f"{stage}: {type(e).__name__}: {e}"[:200])
        return None
    db.metric("llm", stage, (time.time() - t0) * 1000, tin, tout, user_id=user_id, ok=out is not None)
    return out


def _parse_json(text):
    if not text:
        return None
    text = text.strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group(0))
        except ValueError:
            return None
    return None


def _post(url, headers, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # 429와 5xx만 다시 시도한다. 400·401·404는 요청 자체가 틀린 것이라 재시도가 무의미하다.
            if e.code == 429 or e.code >= 500:
                last = e
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {e.read()[:300]!r}")
        except urllib.error.URLError as e:
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"재시도 후 실패: {last}")


def _anthropic(system, user, schema):
    body = {
        "model": config.LLM_MODEL or DEFAULT_ANTHROPIC_MODEL,
        "max_tokens": 16000,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        # 분류·추출이라 깊은 사고가 필요 없다. 사고는 끌 수 없으므로 effort로 낮춘다.
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        # 안전 분류기가 요청을 거절하면 서버가 권장 모델로 같은 요청을 다시 실행한다.
        "fallbacks": "default",
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": os.environ["ANTHROPIC_API_KEY"],
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": "server-side-fallback-2026-07-01",
    }
    r = _post(ANTHROPIC_URL, headers, body, config.LLM_TIMEOUT)
    usage = r.get("usage") or {}
    tin, tout = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    if r.get("stop_reason") == "refusal":
        return None, tin, tout
    text = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text")
    return _parse_json(text), tin, tout


def _schema_hint(schema):
    return "다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 다른 글은 쓰지 않는다.\n" + json.dumps(schema, ensure_ascii=False)


def _openai(system, user, schema):
    body = {
        "model": config.LLM_MODEL,
        "messages": [{"role": "system", "content": system + "\n\n" + _schema_hint(schema)},
                     {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }
    headers = {"Content-Type": "application/json"}
    if config.LLM_API_KEY:
        headers["Authorization"] = f"Bearer {config.LLM_API_KEY}"
    r = _post(config.LLM_BASE_URL.rstrip("/") + "/chat/completions", headers, body, config.LLM_TIMEOUT)
    usage = r.get("usage") or {}
    text = r["choices"][0]["message"]["content"]
    return _parse_json(text), usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


def _claude_cli(system, user, schema):
    prompt = system + "\n\n" + _schema_hint(schema) + "\n\n---\n" + user
    cmd = ["claude", "-p", "--output-format", "json", "--max-turns", "1", "--tools", ""]
    if config.LLM_MODEL:
        cmd += ["--model", config.LLM_MODEL]
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
    env["CONNTEXT_OFF"] = "1"   # 이 호출 자체가 Conntext 훅에 다시 수집되지 않게 한다.
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=config.LLM_TIMEOUT + 60,
                       env=env, cwd="/tmp")
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:300] or r.stdout[:300])
    wrap = json.loads(r.stdout)
    usage = wrap.get("usage") or {}
    # 캐시 읽기(호출마다 약 34만)는 CLI 자체의 시스템 문맥이라 우리 프롬프트 크기가 아니므로 세지 않는다. 그래서 근사값이다.
    tin = (usage.get("input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0)
    return _parse_json(wrap.get("result", "")), tin, usage.get("output_tokens", 0)


# ── 프롬프트 ────────────────────────────────────────────────────────
ANALYZE_SYSTEM = """당신은 개발자 한 사람의 개인 지식 공간을 정리한다. 이 공간의 메모는 그 사람의 코딩 에이전트가 다음 세션에서 참고한다. 새 메모 하나를 받아, 종류를 정하고 기존 메모와의 관계를 판정한다.

종류(kind)는 메모가 어디에 쓰이는지를 정한다. 잘못 고르면 메모가 엉뚱한 곳에 가거나 사라진다.
- instruction: 에이전트에게 하는 말이다. 에이전트가 일하는 방식, 즉 답변의 말투와 언어, 출력 형식, 작업할 때 쓸 명령이나 도구, 하지 말아야 할 행동을 정한다. 모든 세션 시작 때 에이전트에게 항상 주입되고, 위키 문서에는 들어가지 않는다.
- knowledge: 프로젝트, 시스템, 팀에 관한 사실이다. 설정값, 제약, 일정, 담당자, 결정과 그 이유, 원인, 함정이 여기 속한다. 주제별 위키 문서에 묶이고, 관련 있을 때만 검색으로 꺼낸다. 기간에 제한이 없다.
- procedure: 어떤 작업을 하는 방법이다. 특정 작업(배포, 롤백, 인증서 갱신, 로컬 환경 띄우기, 특정 오류 디버깅)을 할 때 따라야 할 순서, 쓸 명령, 빠뜨리면 실패하는 함정을 적은 것이다. 세션 시작 때 '언제 쓰는지'와 제목만 색인으로 들어가고, 에이전트가 그 작업을 하게 되면 본문을 꺼내 따른다.
- state: 지금 진행 중인 작업의 경과다. 어떤 작업이 어디까지 됐고 무엇이 남았는지, 무엇을 기다리는지를 적은 것으로, 그 작업이 끝나면 쓸모가 없어진다. 2주 뒤 자동으로 만료된다. 담당자, 일정, 설정값이 무엇인지는 작업 경과가 아니라 사실이다.

헷갈리는 경계:
- 규칙처럼 들리는 사실은 knowledge다. "릴리스 브랜치 머지는 QA 승인 뒤에만 가능", "결제 모듈 변경에는 보안팀 리뷰가 필수", "접속 로그는 90일 보관한다"는 '해야 한다'처럼 읽히지만, 에이전트가 없어도 팀원 누구에게나 참인 프로젝트의 사실이다. 이런 메모를 instruction으로 보내면 위키에서 빠지고, 관련 없는 세션에서도 주입 예산을 차지한다.
- 에이전트에게 하는 말이면 사실처럼 써 있어도 instruction이다. "변수 이름은 snake_case", "빌드는 npm 말고 pnpm으로 해 줘", "마이그레이션 파일은 직접 고치지 말 것"은 에이전트가 무엇을 어떻게 하는지를 정한다. 이유가 덧붙어 있어도 마찬가지다. 이런 메모를 knowledge로 보내면 검색될 때만 보여서 지켜지지 않는다.
- 시스템을 다루는 순서나 방법("서비스 A를 먼저 띄우고 B를 띄운다. 반대로 하면 B가 죽는다", "인증서는 certbot renew로 갱신하고 nginx를 reload한다")은 procedure다. 그 작업을 할 때만 필요하므로 항상 주입되는 instruction이 아니고, 무엇이 어떤지를 설명하는 knowledge와도 다르다. 가르는 질문은 '이 메모를 읽고 무엇을 하는가'다. 따라 할 단계나 명령이 나오면 procedure, 알고 있으면 되는 사실이면 knowledge다.
- procedure와 instruction: 평소 작업 전반에 늘 적용되는 짧은 규칙("빌드는 npm 말고 pnpm으로", "커밋 메시지는 한국어로")은 instruction이다. 특정 작업(재시작, 배포, 갱신, 복구)을 할 때만 필요한 순서·명령·주의점은 '반드시', '해야 한다', '하지 마'처럼 규칙 꼴로 적혀 있어도 procedure다. 그 작업을 하지 않는 세션에 매번 넣을 이유가 없기 때문이다.
- 이유만 적힌 사실("배포가 느린 건 이미지가 커서다")이나 결정("타임아웃을 10초로 정했다")은 단계가 없으므로 knowledge다.
- 저장소와 무관한 개인 선호("설명은 짧게 해 줘", "이모지는 쓰지 마")도 에이전트의 행동을 정하므로 instruction이다.
- 가르는 질문은 '누구에게 하는 말인가'다. 에이전트의 행동을 정하면 instruction, 세계(프로젝트·시스템·팀)를 설명하면 knowledge다.
- state는 시간이 지나면 의미가 없어지는 것만이다. "로그인 리팩터링은 미들웨어 분리까지 끝났고 테스트 수정이 남음", "인증서 갱신 건은 인프라팀 회신 대기"가 state다. "변경됨", "이제부터", "바뀌었다"는 값이 바뀌었다는 뜻일 뿐 진행 상태가 아니다. "릴리스 주기가 격주에서 매주로 바뀌었다", "운영 담당이 김 책임에서 박 선임으로 바뀌었다"는 바뀐 뒤의 값을 알려 주는 사실이고 앞으로 계속 참이므로 knowledge다. 기존 메모를 갱신하는 메모의 종류도 바뀐 뒤의 내용으로 정한다. 2주 뒤에도 읽을 가치가 있으면 state가 아니다.
- 종류는 새 메모의 내용만 보고 정한다. 후보 메모에 붙은 종류는 이전에 잘못 분류됐을 수 있으니 따라가지 않는다.

관계(relation)는 후보 메모 가운데 가장 가까운 하나에 대해 정한다. 후보에는 같은 저장소라는 이유로 함께 넘어온, 새 메모와 관계없는 메모도 섞여 있다. duplicate, update, supplement는 후보가 새 메모와 같은 사안이나 같은 대상을 다룰 때만 고른다.
- duplicate: 같은 내용을 다시 적은 것.
- update: 같은 사안의 값이나 결정이 바뀐 것. 새 메모가 후보를 대체한다. 날짜, 담당자, 수치가 바뀐 경우가 여기 해당한다.
- supplement: 같은 주제에 정보를 더한 것. 후보 내용은 여전히 유효하다.
- related: 주제는 다르지만 함께 보면 도움이 되는 것.
- none: 관련 후보가 없다.
확신이 없으면 더 약한 관계를 고른다. 잘못 합치면 정보가 사라지지만, 따로 두면 나중에 합칠 수 있다.

주제(topic): 이 메모가 속할 위키 문서. 먼저 이 메모가 무엇에 관한 것인지 짧은 구절로 정한다. 기존 주제 가운데 그 구절과 같은 대상을 다루는 것이 있으면 그 id를 주고, 없으면 그 구절을 새 제목으로 준다. 제목은 한 문서에 메모 여러 개가 모일 만큼 넓게, 그러나 무엇에 관한 문서인지 알 만큼 구체적으로 짓는다(예: "결제 API 재시도 정책", "모바일 앱 릴리스 절차"). 기존 주제는 그 제목이 이 메모가 다루는 대상을 실제로 다룰 때만 고른다. 같은 저장소나 같은 시스템이라는 것만으로는 부족하다. 릴리스 절차 문서에 캐시 설정 메모를 넣으면 두 문서 모두 읽기 어려워진다. 절차 문서(기존 주제 목록에서 '(절차)'가 붙은 것)와 지식 문서는 섞지 않는다. kind가 procedure이면 절차 문서만, knowledge이면 지식 문서만 고르고, 맞는 것이 없으면 새 제목을 준다. procedure의 새 제목은 하는 일을 드러낸다(예: "스테이징 배포 절차", "인증서 갱신 방법"). kind가 instruction이나 state이면 주제는 비운다.

when: kind가 procedure일 때만, 이 절차를 언제 꺼내 써야 하는지 한 줄로 쓴다. '…할 때' 꼴로 30자 이내(예: "스테이징에 배포할 때", "로그인 테스트가 타임아웃으로 실패할 때"). 에이전트가 세션 시작 색인에서 이 줄만 보고 지금 작업에 해당하는지 판단하므로, 작업이나 증상을 구체적으로 쓴다. 다른 종류면 빈 문자열로 둔다.

개체(entities): 메모에 실제로 등장한 사람, 시스템, 프로젝트, 고유 용어만 뽑는다. 일반 명사는 뽑지 않는다.

title은 메모를 목록에서 알아볼 수 있는 40자 이내의 한 줄이다. 글자 수를 맞추려고 단어 중간에서 자르지 말고, 끝에 마침표나 말줄임표를 붙이지 않는다."""

ANALYZE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["instruction", "knowledge", "procedure", "state"]},
        "title": {"type": "string"},
        "when": {"type": "string"},
        "entities": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "kind": {"type": "string", "enum": ["person", "system", "project", "term"]}},
            "required": ["name", "kind"], "additionalProperties": False}},
        "relation": {"type": "string", "enum": ["duplicate", "update", "supplement", "related", "none"]},
        "target_id": {"type": ["integer", "null"]},
        "related_ids": {"type": "array", "items": {"type": "integer"}},
        "topic_id": {"type": ["integer", "null"]},
        "topic_title": {"type": ["string", "null"]},
    },
    "required": ["kind", "title", "when", "entities", "relation", "target_id", "related_ids", "topic_id", "topic_title"],
    "additionalProperties": False,
}

TOPIC_SYSTEM = """당신은 한 주제에 모인 메모들로 위키 문서 본문을 쓴다. 독자는 메모를 쓴 본인이거나 그 팀 동료이고, 이 문서로 해당 주제의 현재 상태를 빠르게 파악하려 한다.

- 메모에 있는 내용만 쓴다. 추측이나 일반론을 보태지 않는다.
- 현재 유효한 내용을 먼저 쓴다. '대체됨'으로 표시된 메모는 지금은 틀린 내용이므로 본문에 사실처럼 쓰지 않는다. 변경 이력이 독자에게 쓸모 있을 때만 '이전에는 …였다'로 한 줄 남긴다.
- '세션 자동 추출'로 표시된 메모는 사람이 확인하지 않은 내용이다. 쓸 때는 '(미확인)'을 붙인다.
- 문장이나 항목마다 근거 메모를 [m:ID] 형식으로 붙인다. 근거 없는 문장은 쓰지 않는다.
- 마크다운으로 쓴다. 메모가 적으면 문단 하나로 충분하고, 많으면 소제목(##)과 목록으로 나눈다. 문서 제목은 쓰지 않는다."""

# 절차 문서(#16). 에이전트가 이 문서를 꺼내 그대로 따라 하므로, 읽는 글이 아니라 실행할 순서로 쓴다.
TOPIC_PROCEDURE_RULES = """

이 주제는 절차 문서다. 에이전트가 해당 작업을 시작할 때 이 문서를 꺼내 그대로 따라 한다. 다음 형식으로 쓴다.
- 첫 줄에 언제 쓰는 절차인지 한 문장으로 쓴다.
- 단계는 번호 목록으로, 실제 순서대로 쓴다. 명령, 파일 경로, 설정 이름은 메모에 적힌 그대로 백틱으로 감싼다. 메모에 없는 단계나 명령을 지어내지 않는다.
- 빠뜨리거나 순서를 바꾸면 실패하는 점은 '## 주의' 아래에 '규칙 — 이유' 꼴로 쓴다. 이유는 메모에 있을 때만 한 절로 붙인다.
- 서로 다른 작업의 절차가 한 문서에 모였으면 작업마다 소제목(##)으로 나눈다.
- 대체된 메모는 본문 없이 번호만 온다. 옛 단계나 명령을 짐작해 쓰지 않는다."""

TOPIC_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"], "additionalProperties": False,
}

SESSION_SYSTEM = """당신은 개발자가 코딩 에이전트와 진행한 세션 기록을 읽고 두 가지를 뽑는다. 결과는 같은 사람이 다음 세션이나 다른 에이전트에서 일을 이어갈 때 쓰인다.

1. 진행 상태(handoff): 이 세션에서 끝낸 일(done), 남은 일(remaining), 이어받는 쪽이 알아야 할 주의점(notes). 기록에 근거가 있는 것만 쓰고, 항목은 파일 이름이나 식별자를 넣어 구체적으로 쓴다. 남은 일이 없으면 빈 목록으로 둔다.

2. 지식 후보(candidates): 이 세션이 끝난 뒤에도 쓸모가 있는 내용. 내린 결정과 그 이유, 찾아낸 원인, 프로젝트의 규칙이나 함정, 다시 하게 될 작업의 검증된 방법이 해당한다. 각 후보는 세션을 보지 않은 사람도 이해할 수 있게 한두 문장으로(procedure는 짧은 단계 목록으로) 독립적으로 쓴다.
   대부분의 세션에는 남길 만한 것이 없거나 한두 개뿐이다. 코드를 읽으면 알 수 있는 것, 이번 작업에만 해당하는 세부, 일반 상식은 뽑지 않는다. 뽑을 것이 없으면 빈 목록을 준다. 최대 5개.

   후보는 사람이 확인하면 이 사람의 다음 세션들에 쓰인다. 잘못된 후보 하나가 이후 모든 세션을 오도하므로, 아래 기준으로 거른다. 확신이 서지 않으면 뽑지 않는다.

   - 근거가 기록에 있어야 한다. 사용자가 말한 것이나 도구 결과(테스트 출력, 오류, 명령 결과)로 확인된 것만 뽑는다. 에이전트가 "아마", "~일 수 있다"고 짐작만 하고 확인하지 않은 원인이나 설명은 사실로 뽑지 않는다. 나중에 확인됐다면 확인된 내용을 뽑는다.
   - 사람에 대해 추측하지 않는다. 질문 주제, 말투, 쓴 도구로 사용자의 수준, 역할, 성향, 기분, 선호를 짐작해 적지 않는다. 사용자가 자기에 대해 직접 말한 것만 쓸 수 있다.
   - kind는 대부분 knowledge다. instruction은 에이전트가 이 사람의 모든 세션에서 늘 따를 규칙이고, 확인되면 세션마다 항상 들어간다. 그래서 다음 두 경우에만 instruction으로 뽑는다.
     · 사용자가 일반적인 규칙이라고 표시했다: "항상", "앞으로", "매번", "기억해", "다음부터".
     · 사용자가 계속되는 호불호를 밝혔다: "X는 싫다", "Y 그만해", "Z 하지 마"처럼 이번 한 번이 아니라 늘 그렇다는 말.
     이번 한 번만 해당하는 요청("이번엔 표로 보여 줘", "짧게 답해", "이 파일만 고쳐 줘")은 어떤 종류로도 뽑지 않는다. 같은 요청이 세션 안에서 여러 번 나와도, 사용자가 일반 규칙이라고 말하지 않았으면 뽑지 않는다.
   - 이 일회성 기준은 응답 방식과 이번 작업 범위에 대한 요청에만 해당한다. 프로젝트에 대해 내린 결정("타임아웃을 10초로 늘리자, 현장 지연이 8초라서")은 한 번 말했어도 근거가 있는 지식이므로 knowledge로 뽑는다.
   - procedure는 다시 하게 될 작업의 방법이다. 다음 두 경우에 뽑는다.
     · 여러 단계를 거쳐야 하는 작업(빌드, 배포, 환경 구성, 특정 오류의 진단)이 시행착오 끝에 성공했다. 성공이 도구 결과(명령 성공, 테스트 통과)로 확인돼야 한다.
     · 사용자가 에이전트의 작업 방법을 바로잡았고("그거 말고 먼저 X부터 해", "Y는 Z 옵션을 줘야 돼"), 그대로 해서 됐다. 특정 작업의 순서나 명령을 바로잡은 것은 규칙처럼 말했어도 instruction이 아니라 procedure다. instruction은 작업과 상관없이 늘 따르는 규칙에만 쓴다.
     text에는 성공한 순서와 명령을 그대로 적고, 실패했던 시도 가운데 다시 하면 안 되는 것을 이유와 함께 한 번 적는다. 실패한 시도의 순서는 적지 않는다. 한 번만 할 작업이거나, 성공이 확인되지 않았으면 뽑지 않는다.
   - when은 kind가 procedure일 때만, 이 절차를 언제 꺼내 써야 하는지 '…할 때' 꼴로 30자 이내로 쓴다. 다른 종류면 빈 문자열이다.

summary는 이 세션이 무엇을 한 세션인지 한 문장으로 쓴다."""

SESSION_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "handoff": {"type": "object", "properties": {
            "done": {"type": "array", "items": {"type": "string"}},
            "remaining": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"}},
            "required": ["done", "remaining", "notes"], "additionalProperties": False},
        "candidates": {"type": "array", "items": {"type": "object", "properties": {
            "text": {"type": "string"}, "kind": {"type": "string", "enum": ["knowledge", "procedure", "instruction"]},
            "when": {"type": "string"}},
            "required": ["text", "kind", "when"], "additionalProperties": False}},
    },
    "required": ["summary", "handoff", "candidates"], "additionalProperties": False,
}
