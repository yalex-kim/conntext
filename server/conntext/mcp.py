"""MCP 서버 (Streamable HTTP, 상태 없음). 슬래시 명령어의 실체가 여기 도구들이다.
어느 에이전트 플랫폼이든 이 엔드포인트 하나에 붙으면 같은 기억을 쓴다."""
import json, time
from . import __version__, access, db, pipeline, retrieval, sessions
from .access import BadRequest, Forbidden, NotFound

PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")

_PROJECT = {"type": "string", "description": "현재 저장소 식별자. 세션 시작 때 Conntext가 알려 준 project 값을 그대로 넣는다. 모르면 `git config --get remote.origin.url` 결과를 넣는다."}

TOOLS = [
    {"name": "remember",
     "description": "사용자의 메모를 Conntext에 저장한다. 사용자가 기억해 두라고 했거나 /remember를 썼을 때 호출한다. "
                    "사용자가 적은 문장을 다듬지 말고 그대로 넘긴다. 결과의 message를 사용자에게 그대로 보여 준다.",
     "inputSchema": {"type": "object", "properties": {
         "text": {"type": "string", "description": "저장할 내용. 사용자 표현 그대로."},
         "project": _PROJECT,
         "scope": {"type": "string", "enum": ["project", "global"], "description": "project: 이 저장소에서만 적용(기본). global: 모든 작업에 적용. 사용자가 --global이라고 했거나 저장소와 무관한 개인 선호일 때 global."},
         "replaces": {"type": "integer", "description": "이 메모가 고쳐 쓰는 기존 메모 id. 사용자가 기존 메모가 틀렸다고 바로잡을 때 넣는다."}},
         "required": ["text"]}},
    {"name": "recall",
     "description": "사용자의 개인 공간과 소속 팀 공간에서 관련 메모를 찾는다. 작업에 필요한 배경, 결정, 규칙이 있을 것 같을 때나 /recall에 쓴다. "
                    "결과에는 등급이 붙는다: [내 메모]는 사용자가 직접 적은 것, [팀 지식]은 동료가 공유한 것, [세션 자동 추출·미확인]은 사람이 확인하지 않은 것이다. "
                    "[팀 지식 · … · 원본이 바뀜/삭제됨]은 작성자가 공유한 뒤 원본을 고치거나 지운 것이라 낡았을 수 있다. "
                    "미확인 내용을 근거로 쓸 때는 미확인임을 사용자에게 밝힌다.",
     "inputSchema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "찾을 내용. 자연어 문장이나 핵심 단어."},
         "project": _PROJECT,
         "limit": {"type": "integer", "description": "결과 수(기본 6)."}},
         "required": ["query"]}},
    {"name": "search_sessions",
     "description": "사용자의 지난 세션 대화록(Claude Code·OpenCode)을 찾거나 읽는다. 정리된 지식은 recall로 찾고, "
                    "'그때 무슨 얘기를 했지', '어떤 명령으로 고쳤지', '그때 어떤 오류였지'처럼 지난 대화 자체가 필요할 때 쓴다. "
                    "모양은 인자로 정해진다: query = 찾기(걸린 줄과 앞뒤 줄), session_id = 읽기(from_line·to_line으로 범위), 인자 없음 = 최근 세션 목록. "
                    "대화록은 발화와 도구 이름, 실패한 도구의 오류 출력 앞부분만 담고 파일 내용은 없다. 본인 세션만, 보존 기간(기본 90일) 안의 것만 나온다. "
                    "결과의 L번호는 그 세션의 줄 번호라, 더 읽으려면 session_id와 from_line·to_line을 넣어 다시 부른다.",
     "inputSchema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "찾을 단어나 문장. 고유한 단어(파일 이름, 명령, 오류 문구)일수록 잘 찾는다."},
         "session_id": {"type": "integer", "description": "읽을 세션 id(찾기 결과의 s:번호)."},
         "from_line": {"type": "integer"}, "to_line": {"type": "integer"},
         "after": {"type": "string", "description": "이 시각 이후의 세션만. 7d·24h·2w 같은 상대값이나 2026-11-01 같은 날짜. 사용자가 기간을 말했을 때만."},
         "before": {"type": "string"},
         "sort": {"type": "string", "enum": ["newest", "oldest"], "description": "생략하면 관련도 순. '어디까지 했지'는 newest, '처음에 어떻게 시작했지'는 oldest."},
         "limit": {"type": "integer", "description": "찾기에서 돌려줄 세션 수(기본 3, 최대 10)."}}}},
    {"name": "get_memos",
     "description": "메모 id로 전문과 이력(대체 관계, 소속 주제)을 가져온다. 세션 시작 색인이나 recall 결과의 [m:숫자]를 자세히 볼 때 쓴다.",
     "inputSchema": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "integer"}}}, "required": ["ids"]}},
    {"name": "get_topic",
     "description": "주제 문서 하나의 본문을 가져온다. 세션 시작 색인의 [t:숫자]를 펼칠 때 쓴다.",
     "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}},
    {"name": "resume",
     "description": "이 저장소에서 지난 세션이 남긴 진행 상태(끝낸 일, 남은 일)와 관련 메모를 가져온다. 사용자가 이어서 하자고 하거나 /resume을 썼을 때 호출한다.",
     "inputSchema": {"type": "object", "properties": {"project": _PROJECT}}},
    {"name": "handoff",
     "description": "지금까지의 진행 상태를 저장한다. 다음 세션이나 다른 에이전트가 resume으로 이어받는다. /handoff에 쓴다. "
                    "text에는 끝낸 일, 남은 일, 이어받는 쪽이 알아야 할 주의점을 파일 이름과 식별자를 넣어 구체적으로 적는다.",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}, "project": _PROJECT}, "required": ["text"]}},
    {"name": "forget",
     "description": "메모를 삭제한다. memo_id를 주면 그 메모를 지우고, query만 주면 지울 후보를 찾아 돌려준다(이때는 지우지 않는다). "
                    "후보를 사용자에게 보여 주고 어느 것인지 확인받은 뒤 memo_id로 다시 호출한다. undo_last가 true면 가장 최근의 저장·삭제를 되돌린다.",
     "inputSchema": {"type": "object", "properties": {
         "memo_id": {"type": "integer"}, "query": {"type": "string"}, "undo_last": {"type": "boolean"}}}},
    {"name": "mark_used",
     "description": "recall이나 세션 시작 색인으로 받은 메모 가운데 답이나 작업에 실제로 쓴 것의 id를 알린다. 쓰인 메모는 다음 검색에서 우선되고, 미확인 후보는 충분히 쓰이면 정식 메모가 된다.",
     "inputSchema": {"type": "object", "properties": {"memo_ids": {"type": "array", "items": {"type": "integer"}}}, "required": ["memo_ids"]}},
]


def normalize_project(p):
    """git 원격 주소를 장비·프로토콜과 무관한 키로 바꾼다. 예: git@github.com:Org/Repo.git → github.com/org/repo"""
    if not p:
        return None
    p = str(p).strip()
    if not p:
        return None
    import re
    m = re.match(r"^(?:[a-z+]+://)?(?:[^@/]+@)?([^:/]+)(?::\d+(?=/))?[:/](.+?)(?:\.git)?/?$", p)
    if m and "." in m.group(1) and not p.startswith("/"):
        return f"{m.group(1)}/{m.group(2)}".lower()
    if p.startswith("local:"):
        return p
    return "local:" + p.rstrip("/").split("/")[-1].lower()


def _date(ts):
    return time.strftime("%-m/%-d", time.localtime(ts))


def fmt_memo(r):
    tier = r["tier"]
    if tier == "team":
        note = {"changed": " · 원본이 바뀜", "deleted": " · 원본이 삭제됨"}.get(r.get("origin_state"), "")
        tag = f"[팀 지식 · {r['author']}{note}]"
    elif tier == "candidate":
        tag = "[세션 자동 추출·미확인]"
    elif tier == "state":
        tag = "[진행 상태]"
    else:
        tag = "[내 메모]"
    topic = f", 주제: {r['topics'][0]['title']}" if r.get("topics") else ""
    return f"{tag} m:{r['id']} ({_date(r['created_at'])}{topic})\n{r['body']}"


def fmt_recall(res):
    if not res["results"]:
        return f"\"{res['query']}\"에 해당하는 메모가 없습니다."
    out = [f"\"{res['query']}\" 검색 결과 {len(res['results'])}건"]
    out += [fmt_memo(r) for r in res["results"]]
    for t in res["topics"]:
        where = "팀" if t["space_kind"] == "team" else "내"
        out.append(f"── {where} 주제 문서 [t:{t['id']}] {t['title']}\n{t['summary'][:900]}")
    out.append("답에 쓴 메모는 mark_used로 알려 주세요.")
    return "\n\n".join(out)


def _session_head(s):
    proj = pipeline.short_project(s["project_key"]) or "저장소 없음"
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime(s["ended_at"] or s["started_at"]))
    return f"s:{s['id']} · {s['platform']} · {proj} · {when}" + (f"\n요약: {s['summary']}" if s.get("summary") else "")


def _cap(parts):
    out, used = [], 0
    for p in parts:
        if used + len(p) > sessions.RESULT_CHARS:
            out.append(f"…(결과가 길어 {len(parts) - len(out)}개 부분을 생략했습니다. 범위를 좁혀 다시 부르세요)")
            break
        out.append(p)
        used += len(p)
    return "\n\n".join(out)


def fmt_search_sessions(user, a):
    after, before = sessions.parse_when(a.get("after")), sessions.parse_when(a.get("before"))
    if a.get("session_id"):
        s = sessions.read_session(user, int(a["session_id"]))
        lines = s["transcript"].splitlines()
        lo = max(1, int(a.get("from_line") or 1))
        hi = min(len(lines), int(a.get("to_line") or (lo + sessions.READ_LINES - 1)))
        body = "\n".join(f"L{i} {lines[i - 1]}" for i in range(lo, hi + 1))
        more = f"\n…(전체 {len(lines)}줄 중 L{lo}–L{hi}. 더 읽으려면 from_line={hi + 1})" if hi < len(lines) else ""
        return _cap([_session_head(s), body + more])
    if not (a.get("query") or "").strip():
        rows = sessions.recent_sessions(user, a.get("limit") or 10)
        if not rows:
            return "검색할 수 있는 지난 세션이 없습니다. 세션이 끝나면 대화록이 올라옵니다(기록을 꺼 둔 세션은 제외)."
        return "최근 세션\n" + "\n".join(_session_head(r).replace("\n", " / ") for r in rows)
    hits = sessions.search_sessions(user, a["query"], after, before, a.get("limit") or 3, a.get("sort"))
    if not hits:
        return f"\"{a['query']}\"에 해당하는 지난 세션 대화가 없습니다. 다른 단어(파일 이름, 명령, 오류 문구)로 다시 찾거나 기간을 넓혀 보세요."
    parts = [f"\"{a['query']}\" 지난 세션 {len(hits)}개"]
    for h in hits:
        s = h["session"]
        lines = s["transcript"].splitlines()
        keep = set()
        for ln in h["lines"]:
            keep.update(range(max(1, ln - sessions.SEARCH_CONTEXT), min(len(lines), ln + sessions.SEARCH_CONTEXT) + 1))
        out, prev = [], None
        for i in sorted(keep):
            if prev is not None and i != prev + 1:
                out.append("…")
            out.append(f"L{i} {lines[i - 1][:400]}")
            prev = i
        parts.append(_session_head(s) + "\n" + "\n".join(out))
    parts.append("더 읽으려면 search_sessions에 session_id와 from_line·to_line을 넣는다.")
    return _cap(parts)


def fmt_resume(res):
    st = res["state"]
    if not st:
        o = res.get("other_project_state")
        if o:
            return (f"이 저장소에는 이어받을 진행 상태가 없습니다.\n다른 작업의 최근 상태({pipeline.short_project(o['project_key']) or '전체'}, {_date(o['created_at'])}):\n{o['body']}")
        return "이어받을 진행 상태가 없습니다. 세션이 끝날 때 자동으로 남거나, /handoff로 직접 남길 수 있습니다."
    where = f"{st['platform']}, " if st.get("platform") else ""
    out = [f"지난 진행 상태 m:{st['id']} ({where}{time.strftime('%-m/%-d %H:%M', time.localtime(st['created_at']))})\n{st['body']}"]
    if res["related"]:
        out.append("관련 메모:\n" + "\n\n".join(fmt_memo(r) for r in res["related"]))
    return "\n\n".join(out)


def _memo_ids(a):
    """mark_used의 id 목록. 모델이 이름(ids)이나 형식("[8]", "8,9", "m:8")을 틀려도 받아 준다.
    조용히 0건으로 처리하면 사용 기록이 사라지고, 후보 자동 승격과 색인 순서가 틀어진다."""
    import re
    raw = a.get("memo_ids", a.get("ids", a.get("memo_id", [])))
    if isinstance(raw, (int, float)):
        raw = [raw]
    if isinstance(raw, str):
        raw = re.findall(r"\d+", raw)
    out = []
    for v in raw or []:
        try:
            out.append(int(re.sub(r"\D", "", str(v)) if isinstance(v, str) else v))
        except (TypeError, ValueError):
            continue
    return list(dict.fromkeys(out))


def call_tool(user, name, a, session_ext_id=None):
    db.metric("cmd", name, user_id=user["id"])
    project = normalize_project(a.get("project"))
    if name == "remember":
        scope = a.get("scope")
        if scope not in (None, "project", "global"):
            raise BadRequest("scope는 project 또는 global입니다.")
        if a.get("replaces"):
            access.get_memo(user, a["replaces"], write=True)
        return pipeline.remember(user, a.get("text", ""), scope=scope, project_key=project, replaces_id=a.get("replaces"))["message"]
    if name == "recall":
        return fmt_recall(retrieval.recall(user, a.get("query", ""), project, session_ext_id, limit=min(int(a.get("limit") or 6), 20)))
    if name == "search_sessions":
        return fmt_search_sessions(user, a)
    if name == "get_memos":
        out = []
        for mid in (a.get("ids") or [])[:20]:
            try:
                m = access.get_memo(user, mid)
            except (NotFound, Forbidden):
                out.append(f"m:{mid} 없음")
                continue
            sp = db.one("SELECT kind, name FROM spaces WHERE id=?", m["space_id"])
            m.update(space_kind=sp["kind"], space_name=sp["name"], author_name=db.val("SELECT name FROM users WHERE id=?", m["author_id"]),
                     tier=retrieval.tier_of(m, sp["kind"]), score=0)
            s = fmt_memo(retrieval._memo_view(m))
            if m["status"] != "active":
                s += f"\n(상태: {m['status']}" + (f", m:{m['superseded_by']}로 대체됨)" if m["superseded_by"] else ")")
            out.append(s)
        return "\n\n".join(out) or "id가 없습니다."
    if name == "get_topic":
        t = db.one("SELECT * FROM topics WHERE id=?", a.get("id"))
        if not t:
            raise NotFound("주제를 찾을 수 없습니다.")
        access.require_read(user, t["space_id"])
        return f"# {t['title']}\n\n{t['summary'] or '(아직 본문이 없습니다)'}"
    if name == "resume":
        return fmt_resume(retrieval.resume(user, project))
    if name == "handoff":
        return sessions.save_handoff(user, project, a.get("text", ""))["message"]
    if name == "forget":
        if a.get("undo_last"):
            return pipeline.undo_last(user)["message"]
        if a.get("memo_id"):
            return pipeline.forget(user, a["memo_id"])["message"] + "\n되돌리려면 forget에 undo_last=true."
        if a.get("query"):
            hits = retrieval.search([access.personal_space_id(user["id"])], a["query"], None, limit=5)
            if not hits:
                return "해당하는 메모가 없습니다."
            lines = ["지울 후보입니다. 어느 것인지 사용자에게 확인한 뒤 memo_id로 다시 호출하세요."]
            lines += [f"m:{h['id']} ({_date(h['created_at'])}) {h['body'][:160]}" for h in hits]
            return "\n".join(lines)
        raise BadRequest("memo_id, query, undo_last 가운데 하나가 필요합니다.")
    if name == "mark_used":
        r = retrieval.mark_used(user, _memo_ids(a), session_ext_id)
        return f"사용 기록 {r['marked']}건." + (f" 후보 {len(r['promoted'])}건이 정식 메모로 올라갔습니다." if r["promoted"] else "")
    raise NotFound(f"알 수 없는 도구: {name}")


def handle(user, msg, session_ext_id=None):
    """JSON-RPC 메시지 하나를 처리한다. 알림이면 None."""
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if mid is None:
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    if method == "initialize":
        want = params.get("protocolVersion")
        return ok({"protocolVersion": want if want in PROTOCOLS else PROTOCOLS[0],
                   "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": "conntext", "title": "Conntext", "version": __version__},
                   "instructions": "Conntext는 사용자의 메모와 진행 상태를 세션과 에이전트 사이에 이어 준다. 저장은 remember, 조회는 recall, 이어받기는 resume."})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        try:
            text = call_tool(user, params.get("name"), params.get("arguments") or {}, session_ext_id)
            return ok({"content": [{"type": "text", "text": text}], "isError": False})
        except (BadRequest, NotFound, Forbidden) as e:
            return ok({"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception as e:
            db.trace("mcp_error", f"{params.get('name')}: {type(e).__name__}: {e}")
            return ok({"content": [{"type": "text", "text": f"Conntext 서버 오류: {type(e).__name__}"}], "isError": True})
    if method in ("resources/list", "prompts/list"):
        return ok({method.split("/")[0]: []})
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}}
