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
        r = pipeline.remember(user, text, project_key=s["project_key"], kind=None if c.get("kind") != "instruction" else "instruction",
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
    db.ex("UPDATE sessions SET transcript=NULL WHERE transcript IS NOT NULL AND COALESCE(ended_at, started_at)<?", now - ret["transcript_days"] * 86400)
    for t in db.q("SELECT id FROM topics WHERE dirty=1"):
        jobs.enqueue("topic_summary", {"topic_id": t["id"]}, dedupe=True)
    db.ex("DELETE FROM metrics WHERE created_at<?", now - 60 * 86400)
