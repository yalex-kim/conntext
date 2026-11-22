"""세션 수집과 추출.

훅은 대화록만 넘기고, 추출은 서버가 비동기로 한다. 저장하는 것은 원본 JSONL이 아니라
사용자·에이전트의 발화와 도구 호출 이름만 남긴 축약본이다. 도구 결과(파일 내용, 명령 출력)는 버린다.
"""
import json, re, time
from . import access, config, db, jobs, llm, masking, pipeline, retrieval

MARKERS = re.compile(r"원인은|때문|해결|결정|하기로|주의|반드시|알고 ?보니|root cause|fixed by|turns out|the fix|decided", re.I)
REMAIN = re.compile(r"남은|남았|TODO|다음(으로|에)|아직|미완|후속|next step|remaining|follow[- ]?up", re.I)


def _text_of(content):
    if isinstance(content, str):
        return content, []
    texts, tools = [], []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            texts.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            inp = b.get("input") or {}
            hint = inp.get("command") or inp.get("file_path") or inp.get("pattern") or inp.get("description") or ""
            tools.append(f"{b.get('name')}: {str(hint)[:120]}")
    return "\n".join(texts), tools


ERROR_LINES = 20       # 실패한 도구 결과에서 남기는 줄 수
ERROR_LINE_CHARS = 200


def _error_lines(text):
    """실패한 도구의 오류 출력 앞부분. 파일 내용·성공한 출력은 남기지 않는다(#14)."""
    if isinstance(text, list):
        text = "\n".join(b.get("text", "") for b in text if isinstance(b, dict) and b.get("type") == "text")
    rows = [ln.rstrip()[:ERROR_LINE_CHARS] for ln in str(text or "").splitlines() if ln.strip()]
    out = [f"[오류] {ln}" for ln in rows[:ERROR_LINES]]
    if len(rows) > ERROR_LINES:
        out.append(f"[오류] …(오류 출력 {len(rows) - ERROR_LINES}줄 생략)")
    return out


def condense(transcript=None, messages=None):
    """Claude Code JSONL 또는 [{role, text}] 목록을 '사용자:/에이전트:/[도구]' 줄로 줄인다."""
    lines = []
    if messages:
        for m in messages:
            role = "사용자" if m.get("role") == "user" else "에이전트"
            t = (m.get("text") or m.get("content") or "").strip()
            if t:
                lines.append(f"{role}: {t}")
            for tool in m.get("tools") or []:
                lines.append(f"[도구] {str(tool)[:160]}")
            for err in m.get("errors") or []:
                lines += _error_lines(err)
        return "\n".join(lines)
    for raw in (transcript or "").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            e = json.loads(raw)
        except ValueError:
            lines.append(raw[:2000])     # JSONL이 아니면 일반 텍스트 대화록으로 본다.
            continue
        if e.get("type") not in ("user", "assistant") or e.get("isMeta") or e.get("isSidechain"):
            continue
        msg = e.get("message") or {}
        if e["type"] == "user" and isinstance(msg.get("content"), list):
            # 도구 결과는 버리되, 실패한 것의 오류 출력 앞부분만 남긴다.
            for b in msg["content"]:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"):
                    lines += _error_lines(b.get("content"))
        text, tools = _text_of(msg.get("content"))
        text = re.sub(r"<system-reminder>[\s\S]*?</system-reminder>", "", text).strip()
        if e["type"] == "user":
            if text and not text.startswith("<local-command") and not text.startswith("<command-"):
                lines.append(f"사용자: {text}")
        else:
            if text:
                lines.append(f"에이전트: {text}")
            lines += [f"[도구] {t}" for t in tools]
    return "\n".join(lines)


def _clip(text, limit):
    if len(text) <= limit:
        return text
    head = limit // 4
    return text[:head] + "\n…(중략)…\n" + text[-(limit - head):]


def start(user, platform, ext_id, project_key=None, cwd=None, client_version=None):
    # 세션 id가 없으면(클라이언트가 기록을 꺼 둔 경우) 맥락만 돌려주고 세션 행은 만들지 않는다.
    row = db.one("SELECT id FROM sessions WHERE user_id=? AND platform=? AND ext_id=?", user["id"], platform, ext_id) if ext_id else True
    if not row:
        db.insert("sessions", user_id=user["id"], platform=platform, ext_id=ext_id, project_key=project_key, cwd=cwd,
                  started_at=db.now(), status="open")
    ctx = retrieval.build_context(user, project_key, platform, ext_id)
    db.metric("hook", "session-start", ctx["ms"], user_id=user["id"])
    return ctx


def excluded_reason(user, platform, project_key):
    cap = db.policy("capture")
    if user.get("capture_paused"):
        return "사용자가 기록을 꺼 두었습니다."
    if platform not in cap.get("platforms", []):
        return f"수집이 허용되지 않은 플랫폼입니다: {platform}"
    for pat in cap.get("excluded_projects", []):
        if pat and project_key and pat in project_key:
            return "수집 제외 저장소입니다."
    return None


def upload(user, platform, ext_id, project_key=None, cwd=None, transcript=None, messages=None, final=True,
           reason=None, source_acl=None):
    t0 = time.time()
    uid = user["id"]
    row = db.one("SELECT * FROM sessions WHERE user_id=? AND platform=? AND ext_id=?", uid, platform, ext_id)
    sid = row["id"] if row else db.insert("sessions", user_id=uid, platform=platform, ext_id=ext_id, project_key=project_key,
                                         cwd=cwd, started_at=db.now(), status="open")
    why = excluded_reason(user, platform, project_key)
    if why:
        db.update("sessions", sid, status="excluded", transcript=None, ended_at=db.now())
        db.metric("hook", "session-upload", (time.time() - t0) * 1000, user_id=uid)
        return {"session_id": sid, "status": "excluded", "message": why}
    text = condense(transcript, messages)
    cap = db.policy("capture")
    text = _clip(text, cap.get("max_transcript_chars", 400000))
    text, masked = masking.mask(text)
    fields = dict(transcript=text, transcript_chars=len(text), masked_count=masked, project_key=project_key or (row or {}).get("project_key"),
                  source_acl=source_acl or None)
    if final:
        fields.update(status="uploaded", ended_at=db.now())
    db.update("sessions", sid, **fields)
    index_lines(sid, text)
    db.trace("session_upload", f"{platform}:{'final' if final else 'checkpoint'}:{reason or ''}:chars={len(text)}:masked={masked}", session_id=sid)
    if final and len(text) >= 40:
        jobs.enqueue("session_extract", {"session_id": sid}, dedupe=True)
    db.metric("hook", "session-upload", (time.time() - t0) * 1000, user_id=uid)
    return {"session_id": sid, "status": "uploaded" if final else "checkpoint", "masked": masked}


def heuristic_extract(text):
    users = [l[5:].strip() for l in text.splitlines() if l.startswith("사용자: ")]
    agents = re.findall(r"에이전트: ([\s\S]*?)(?=\n사용자: |\n에이전트: |\n\[도구\]|\Z)", text)
    summary = ("요청: " + users[0][:120] if users else "세션")
    last = agents[-1].strip() if agents else ""
    remaining, done = [], []
    for line in last.splitlines():
        s = line.strip(" -*•\t")
        if not s:
            continue
        if REMAIN.search(s) and len(s) < 240:
            remaining.append(re.sub(r"^(남은 ?일|TODO|다음)\s*[:：]\s*", "", s))
        elif re.search(r"완료|끝냈|수정했|추가했|고쳤|done|fixed|added", s, re.I) and len(s) < 200:
            done.append(s)
    cands, seen = [], set()
    for a in agents:
        for sent in re.split(r"(?<=[.!?다요음])\s+|\n", a):
            s = sent.strip(" -*•\t")
            if 20 <= len(s) <= 240 and MARKERS.search(s) and s not in seen:
                seen.add(s)
                cands.append({"text": s, "kind": "knowledge"})
    notes = "" if (done or remaining) else last[:300]
    return {"summary": summary, "handoff": {"done": done[:6], "remaining": remaining[:6], "notes": notes},
            "candidates": cands[:3]}


def format_handoff(h, summary=None):
    parts = []
    if summary:
        parts.append(summary.strip())
    if h.get("done"):
        parts.append("완료: " + "; ".join(h["done"]))
    if h.get("remaining"):
        parts.append("남은 일: " + "; ".join(h["remaining"]))
    if h.get("notes"):
        parts.append("주의: " + h["notes"].strip())
    return "\n".join(parts)


def save_handoff(user, project_key, body, platform=None, session_id=None, source="manual"):
    """진행 상태는 저장소마다 최신 하나만 유효하다. 새 상태가 이전 상태를 대체한다."""
    pid = access.personal_space_id(user["id"])
    prev = db.q("SELECT id FROM memos WHERE space_id=? AND kind='state' AND status='active' AND "
                + ("project_key=?" if project_key else "project_key IS NULL"), pid, *((project_key,) if project_key else ()))
    res = pipeline.remember(user, body, kind="state", scope="project" if project_key else "global", project_key=project_key,
                            source=source, trust="temp", origin_session_id=session_id)
    for p in prev:
        db.ex("UPDATE memos SET status='superseded', superseded_by=?, updated_at=? WHERE id=?", res["memo_id"], db.now(), p["id"])
    res["message"] = f"진행 상태 저장됨 m:{res['memo_id']} · 범위: " + (f"저장소 {pipeline.short_project(project_key)}" if project_key else "전체") \
        + (f"\n이전 진행 상태 {len(prev)}건을 대체했습니다." if prev else "")
    return res


def extract(session_id):
    s = db.one("SELECT * FROM sessions WHERE id=?", session_id)
    if not s or not s["transcript"]:
        return None
    user = db.one("SELECT * FROM users WHERE id=?", s["user_id"])
    t0 = time.time()
    out = None
    if llm.provider() != "heuristic":
        prompt = f"플랫폼: {s['platform']}\n저장소: {s['project_key'] or '없음'}\n\n세션 기록:\n{_clip(s['transcript'], 60000)}"
        out = llm.complete_json("session_extract", llm.SESSION_SYSTEM, prompt, llm.SESSION_SCHEMA, user["id"])
    by = "llm" if out else "rule"
    if not out:
        out = heuristic_extract(s["transcript"])
    h = out.get("handoff") or {}
    handoff_text = format_handoff(h, out.get("summary"))
    created = []
    if h.get("remaining") or h.get("done") or h.get("notes"):
        save_handoff(user, s["project_key"], handoff_text, s["platform"], session_id, source="session")
    for c in (out.get("candidates") or [])[:5]:
        text = (c.get("text") or "").strip()
        if len(text) < 10:
            continue
        # knowledge는 분석에 맡긴다(같은 사안의 기존 메모를 따라가도록). instruction·procedure는 추출 판정을 그대로 쓴다.
        kind = c.get("kind") if c.get("kind") in ("instruction", "procedure") else None
        r = pipeline.remember(user, text, project_key=s["project_key"], kind=kind, when=c.get("when") if kind == "procedure" else None,
                              source="session", trust="low", origin_session_id=session_id, source_acl=s["source_acl"])
        if r["status"] == "active":
            created.append(r["memo_id"])
    db.update("sessions", session_id, status="extracted", summary=out.get("summary"), handoff=h, pipeline_version=config.PIPELINE_VERSION)
    db.trace("session_extract", f"{by}:candidates={len(created)}", session_id=session_id, ms=(time.time() - t0) * 1000)
    return {"session_id": session_id, "candidates": created, "by": by}


@jobs.handler("session_extract")
def _job_extract(p):
    extract(p["session_id"])


@jobs.handler("topic_summary")
def _job_topic(p):
    pipeline.regenerate_topic(p["topic_id"])


@jobs.handler("reprocess_memo")
def _job_reprocess(p):
    m = db.one("SELECT * FROM memos WHERE id=?", p["memo_id"])
    if not m or m["status"] != "active":
        return
    from . import embed
    pipeline.retitle(m)
    db.ex("UPDATE memos SET embedding=?, pipeline_version=? WHERE id=?", embed.pack(embed.embed(m["body"])), config.PIPELINE_VERSION, m["id"])
    for tid in pipeline._topics_of(m["id"]):
        pipeline.mark_dirty(tid)


def maintenance():
    """보존 기간 정리. 워커가 한가할 때 주기적으로 돈다."""
    now = db.now()
    ret = db.policy("retention")
    # 쓰이지 않은 세션 추출 후보 만료
    cut = now - ret["candidate_days"] * 86400
    db.ex("UPDATE memos SET status='expired', updated_at=? WHERE trust='low' AND status='active' AND use_count=0 AND created_at<?", now, cut)
    # 진행 상태 만료
    db.ex("UPDATE memos SET status='expired', updated_at=? WHERE kind='state' AND status='active' AND expires_at IS NOT NULL AND expires_at<?", now, now)
    # 삭제한 메모의 본문은 7일 뒤 실제로 지운다(그 전까지는 되돌릴 수 있다).
    for m in db.q("SELECT id FROM memos WHERE status='deleted' AND updated_at<? AND body!=''", now - 7 * 86400):
        db.ex("UPDATE memos SET body='', title='', embedding=NULL WHERE id=?", m["id"])
        db.ex("DELETE FROM memos_fts WHERE rowid=?", m["id"])
    # 세션 대화록 보존 기간
    cut = now - ret["transcript_days"] * 86400
    for r in db.q("SELECT id FROM sessions WHERE transcript IS NOT NULL AND COALESCE(ended_at, started_at)<?", cut):
        drop_lines(r["id"])
    db.ex("UPDATE sessions SET transcript=NULL WHERE transcript IS NOT NULL AND COALESCE(ended_at, started_at)<?", cut)
    # 색인이 없는 대화록(이 기능 이전에 올라온 것)을 색인한다.
    for r in db.q("SELECT id, transcript FROM sessions WHERE transcript IS NOT NULL AND status!='excluded' "
                  "AND id NOT IN (SELECT DISTINCT CAST(session_id AS INTEGER) FROM session_lines) LIMIT 200"):
        index_lines(r["id"], r["transcript"])
    for t in db.q("SELECT id FROM topics WHERE dirty=1"):
        jobs.enqueue("topic_summary", {"topic_id": t["id"]}, dedupe=True)
    db.ex("DELETE FROM metrics WHERE created_at<?", now - 60 * 86400)


# ── 지난 세션 검색(#14) ─────────────────────────────────────────────
# 축약 대화록을 줄 단위로 색인하고, 에이전트가 본인 세션만 찾고 읽는다. LLM은 쓰지 않는다.
SEARCH_CONTEXT = 2        # 걸린 줄 앞뒤로 보여 줄 줄 수
SEARCH_HITS_PER_SESSION = 3
RESULT_CHARS = 5000       # 한 번 호출의 결과 상한
READ_LINES = 80


def drop_lines(session_id):
    db.ex("DELETE FROM session_lines WHERE session_id=?", session_id)


def index_lines(session_id, text):
    drop_lines(session_id)
    for i, ln in enumerate((text or "").splitlines(), 1):
        if ln.strip():
            db.ex("INSERT INTO session_lines(text, session_id, line_no) VALUES(?,?,?)", ln[:2000], session_id, i)


_REL = re.compile(r"^(\d+)\s*([hdw])$", re.I)


def parse_when(v):
    """'7d', '24h', '2w' 또는 ISO 날짜(2026-11-01) → epoch. 못 읽으면 BadRequest."""
    if v in (None, ""):
        return None
    m = _REL.match(str(v).strip())
    if m:
        return db.now() - int(m.group(1)) * {"h": 3600, "d": 86400, "w": 604800}[m.group(2).lower()]
    import datetime
    try:
        d = datetime.datetime.fromisoformat(str(v).strip())
    except ValueError:
        from .access import BadRequest
        raise BadRequest(f"기간을 읽지 못했습니다: {v} (예: 7d, 24h, 2w, 2026-11-01)")
    return int(d.timestamp())


def _own_sessions(user, after=None, before=None):
    sql = ("SELECT id, platform, project_key, started_at, ended_at, summary, transcript FROM sessions "
           "WHERE user_id=? AND transcript IS NOT NULL AND status!='excluded'")
    args = [user["id"]]
    if after:
        sql += " AND COALESCE(ended_at, started_at)>=?"
        args.append(after)
    if before:
        sql += " AND COALESCE(ended_at, started_at)<?"
        args.append(before)
    return {r["id"]: r for r in db.q(sql, *args)}


def _terms(query):
    return [t.lower() for t in re.findall(r"[\w\uac00-\ud7a3./:-]+", query or "") if len(t) >= 2][:12]


def search_sessions(user, query, after=None, before=None, limit=3, sort=None):
    """질의의 단어가 많이 걸린 줄을 찾아, 세션별로 묶어 앞뒤 줄과 함께 돌려준다."""
    own = _own_sessions(user, after, before)
    terms = _terms(query)
    if not own or not terms:
        return []
    ids = list(own)
    marks = ",".join("?" * len(ids))
    long_t = [t for t in terms if len(t) >= 3]
    rows = []
    if long_t:   # 3글자 이상은 trigram 색인으로
        fq = " OR ".join('"' + t.replace('"', "") + '"' for t in long_t)
        rows += db.q(f"SELECT session_id, line_no, text FROM session_lines WHERE session_lines MATCH ? AND session_id IN ({marks}) LIMIT 2000", fq, *ids)
    for t in [t for t in terms if len(t) < 3]:   # 2글자 한국어 단어(배포, 원인 등)는 색인으로 못 찾으므로 직접 찾는다
        rows += db.q(f"SELECT session_id, line_no, text FROM session_lines WHERE text LIKE ? AND session_id IN ({marks}) LIMIT 2000", f"%{t}%", *ids)
    best = {}
    for r in rows:
        low = r["text"].lower()
        score = sum(1 for t in terms if t in low)
        if not score:
            continue
        sid = int(r["session_id"])
        hits = best.setdefault(sid, {})
        hits[int(r["line_no"])] = score
    ranked = []
    for sid, hits in best.items():
        top = sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))[:SEARCH_HITS_PER_SESSION]
        s = own[sid]
        ranked.append({"session": s, "score": max(hits.values()), "lines": sorted(ln for ln, _ in top)})
    when = lambda x: x["session"]["ended_at"] or x["session"]["started_at"]
    if sort == "oldest":
        ranked.sort(key=lambda x: (when(x)))
    elif sort == "newest":
        ranked.sort(key=lambda x: (-when(x)))
    else:
        ranked.sort(key=lambda x: (-x["score"], -when(x)))
    return ranked[:max(1, min(int(limit or 3), 10))]


def read_session(user, session_id, from_line=None, to_line=None):
    s = db.one("SELECT id, platform, project_key, started_at, ended_at, summary, transcript, status FROM sessions WHERE id=? AND user_id=?",
               session_id, user["id"])
    if not s or s["status"] == "excluded":
        from .access import NotFound
        raise NotFound("세션을 찾을 수 없습니다.")
    if not s["transcript"]:
        from .access import NotFound
        raise NotFound("이 세션의 대화록은 보존 기간이 지나 지워졌습니다. 요약과 진행 상태만 남아 있습니다.")
    return s


def recent_sessions(user, limit=10):
    return db.q("SELECT id, platform, project_key, started_at, ended_at, summary, transcript_chars FROM sessions "
                "WHERE user_id=? AND transcript IS NOT NULL AND status!='excluded' ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?",
                user["id"], max(1, min(int(limit or 10), 20)))
