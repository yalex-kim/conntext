"""HTTP 서버: 웹 API, 훅 수신, MCP, 정적 파일."""
import hashlib, json, mimetypes, re, secrets, time, traceback, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from . import __version__, access, admin, config, db, jobs, llm, masking, mcp, pipeline, retrieval, sessions
from .access import BadRequest, Forbidden, NotFound

ROUTES = []
MAX_BODY = 12 * 1024 * 1024


def route(method, pattern, auth=True, roles=None):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn, auth, roles))
        return fn
    return deco


class Unauthorized(Exception):
    pass


# ── 인증 ────────────────────────────────────────────────────────────
def _hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def issue_token(user_id, label, kind="client"):
    tok = "ctx_" + secrets.token_urlsafe(30)
    tid = db.insert("tokens", user_id=user_id, token_hash=_hash(tok), prefix=tok[:10], label=label, kind=kind, created_at=db.now())
    return tid, tok


def auth_user(headers):
    h = headers.get("Authorization") or ""
    tok = h[7:].strip() if h.lower().startswith("bearer ") else ""
    if not tok:
        raise Unauthorized("토큰이 필요합니다.")
    t = db.one("SELECT * FROM tokens WHERE token_hash=? AND revoked_at IS NULL", _hash(tok))
    if not t:
        raise Unauthorized("토큰이 유효하지 않거나 회수됐습니다.")
    u = db.one("SELECT * FROM users WHERE id=? AND deactivated_at IS NULL", t["user_id"])
    if not u:
        raise Unauthorized("비활성화된 계정입니다.")
    ch = {}
    client = headers.get("X-Conntext-Client") or ""
    if "/" in client:
        plat, ver = client.split("/", 1)
        if plat != t["client_platform"] or ver != t["client_version"]:
            ch.update(client_platform=plat[:40], client_version=ver[:20])
    if not t["last_used_at"] or db.now() - t["last_used_at"] > 60:
        ch["last_used_at"] = db.now()
    if ch:
        db.update("tokens", t["id"], **ch)
    u["_token"] = t
    return u


# ── 공용 뷰 ─────────────────────────────────────────────────────────
MEMO_COLS = ("m.id, m.space_id, m.author_id, m.body, m.title, m.kind, m.source, m.trust, m.scope, m.project_key, m.status, "
             "m.superseded_by, m.origin_memo_id, m.origin_session_id, m.source_acl, m.masked_count, m.use_count, m.last_used_at, "
             "m.created_at, m.updated_at, m.expires_at, m.when_hint")


def memo_rows(where, *args, limit=200, order="m.created_at DESC"):
    rows = db.q(f"SELECT {MEMO_COLS}, u.name AS author_name, s.kind AS space_kind, s.name AS space_name FROM memos m "
                f"JOIN users u ON u.id=m.author_id JOIN spaces s ON s.id=m.space_id WHERE {where} ORDER BY {order} LIMIT ?", *args, limit)
    return [decorate(m) for m in rows]


def decorate(m):
    m["tier"] = retrieval.tier_of(m, m["space_kind"])
    m["origin_state"] = pipeline.origin_state(m) if m["space_kind"] == "team" else None
    m["project"] = pipeline.short_project(m["project_key"])
    m["source_acl"] = db.js(m["source_acl"], [])
    m["topics"] = db.q("SELECT t.id, t.title, t.kind FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", m["id"])
    return m


def space_of(req, default_personal=True):
    sid = req.query.get("space_id") or (req.body or {}).get("space_id")
    if sid:
        sid = int(sid)
        access.require_read(req.user, sid)
        return sid
    return access.personal_space_id(req.user["id"])


def space_kind(space_id):
    return db.val("SELECT kind FROM spaces WHERE id=?", space_id)


def projects_of(user_id):
    pid = access.personal_space_id(user_id)
    keys = {}
    for r in db.q("SELECT project_key, MAX(created_at) AS last, COUNT(*) AS n FROM memos WHERE space_id=? AND project_key IS NOT NULL AND status='active' GROUP BY project_key", pid):
        keys[r["project_key"]] = {"key": r["project_key"], "name": pipeline.short_project(r["project_key"]), "memos": r["n"], "last": r["last"]}
    for r in db.q("SELECT project_key, MAX(started_at) AS last FROM sessions WHERE user_id=? AND project_key IS NOT NULL GROUP BY project_key", user_id):
        k = keys.setdefault(r["project_key"], {"key": r["project_key"], "name": pipeline.short_project(r["project_key"]), "memos": 0, "last": 0})
        k["last"] = max(k["last"] or 0, r["last"] or 0)
    return sorted(keys.values(), key=lambda k: -(k["last"] or 0))


def event_view(e):
    d = db.js(e["detail"], {})
    m = db.one("SELECT id, body, kind, status, trust, source FROM memos WHERE id=?", e["memo_id"]) if e["memo_id"] else None
    topics = db.q(f"SELECT id, title FROM topics WHERE id IN ({','.join('?' * len(d.get('topic_ids') or [0]))})", *(d.get("topic_ids") or [0]))
    target = db.one("SELECT id, body FROM memos WHERE id=?", d["target_id"]) if d.get("target_id") else None
    return {"id": e["id"], "action": e["action"], "created_at": e["created_at"], "undone_at": e["undone_at"], "memo": m,
            "relation": d.get("relation"), "target": target, "topics": topics, "created_topic": bool(d.get("created_topic_ids")),
            "masked": d.get("masked", 0), "prev_kind": d.get("prev_kind"),
            # 이벤트 당시 기록된 종류(kind_change면 바꾼 뒤 종류). 메모의 현재 종류는 memo.kind에 있다.
            "kind": d.get("kind"), "when": d.get("when"), "prev_when": d.get("prev_when"),
            "undoable": e["undone_at"] is None and e["action"] in ("remember", "forget", "confirm", "dismiss", "promote", "auto_promoted", "kind_change", "when_change")}


# ── 계정 ────────────────────────────────────────────────────────────
@route("GET", "/api/health", auth=False)
def health(req):
    return {"ok": True, "version": __version__, "llm": llm.provider(), "queue": jobs.stats()["queued"]}


@route("GET", "/api/dev-users", auth=False)
def dev_users(req):
    if not config.DEV_LOGIN:
        raise Forbidden("개발용 로그인이 꺼져 있습니다.")
    return {"users": db.q("SELECT email, name, role FROM users WHERE deactivated_at IS NULL ORDER BY id")}


@route("POST", "/api/login", auth=False)
def login(req):
    if not config.DEV_LOGIN:
        raise Forbidden("개발용 로그인이 꺼져 있습니다. 사내 인증을 연결하세요.")
    u = db.one("SELECT * FROM users WHERE email=? AND deactivated_at IS NULL", (req.body.get("email") or "").strip())
    if not u:
        raise NotFound("등록되지 않은 사용자입니다.")
    _, tok = issue_token(u["id"], "웹 로그인", kind="web")
    db.audit(u["id"], "login", "user", u["id"])
    return {"token": tok}


@route("GET", "/api/me")
def me(req):
    u = req.user
    return {
        "user": {k: u[k] for k in ("id", "email", "name", "role", "capture_paused")},
        "spaces": access.user_spaces(u["id"]),
        "notifications": db.q("SELECT id, body, created_at FROM notifications WHERE user_id=? AND read_at IS NULL ORDER BY id DESC", u["id"]),
        "llm": {"provider": llm.provider(), "model": llm.model_name()},
        "projects": projects_of(u["id"]),
        "public_url": config.PUBLIC_URL, "version": __version__,
    }


@route("PUT", "/api/me")
def me_update(req):
    if "capture_paused" in req.body:
        db.update("users", req.user["id"], capture_paused=1 if req.body["capture_paused"] else 0)
        db.audit(req.user["id"], "capture_pause", "user", req.user["id"], paused=bool(req.body["capture_paused"]))
    return {"ok": True}


@route("POST", "/api/notifications/read")
def notif_read(req):
    db.ex("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", db.now(), req.user["id"])
    return {"ok": True}


@route("GET", "/api/tokens")
def tokens(req):
    return {"tokens": db.q("SELECT id, prefix, label, client_platform, client_version, created_at, last_used_at FROM tokens "
                           "WHERE user_id=? AND kind='client' AND revoked_at IS NULL ORDER BY id DESC", req.user["id"]),
            "min_plugin_version": db.policy("clients").get("min_plugin_version")}


@route("POST", "/api/tokens")
def token_create(req):
    tid, tok = issue_token(req.user["id"], (req.body.get("label") or "내 장비")[:60])
    db.audit(req.user["id"], "token_create", "token", tid)
    return {"id": tid, "token": tok}


@route("DELETE", r"/api/tokens/(\d+)")
def token_revoke(req, tid):
    t = db.one("SELECT * FROM tokens WHERE id=?", int(tid))
    if not t or (t["user_id"] != req.user["id"] and req.user["role"] != "operator"):
        raise NotFound("토큰을 찾을 수 없습니다.")
    db.update("tokens", t["id"], revoked_at=db.now())
    db.audit(req.user["id"], "token_revoke", "token", t["id"], owner=t["user_id"])
    return {"ok": True}


@route("GET", "/api/export")
def export(req):
    pid = access.personal_space_id(req.user["id"])
    db.audit(req.user["id"], "export", "space", pid, pid)
    return {"exported_at": db.now(), "user": req.user["email"],
            "memos": db.q("SELECT id, body, title, kind, when_hint, source, trust, scope, project_key, status, superseded_by, created_at FROM memos WHERE space_id=? AND status!='deleted' ORDER BY id", pid),
            "topics": db.q("SELECT id, title, kind, summary, project_key FROM topics WHERE space_id=? ORDER BY id", pid),
            "sessions": db.q("SELECT platform, project_key, started_at, ended_at, summary, handoff FROM sessions WHERE user_id=? ORDER BY id", req.user["id"])}


@route("DELETE", "/api/me/data")
def delete_my_data(req):
    if req.body.get("confirm") != req.user["email"]:
        raise BadRequest("확인을 위해 본인 이메일을 입력해야 합니다.")
    n = admin.delete_personal_data(req.user["id"])
    db.audit(req.user["id"], "delete_my_data", "user", req.user["id"], memos=n)
    return {"ok": True, "deleted_memos": n}


# ── 홈 ──────────────────────────────────────────────────────────────
@route("GET", "/api/home")
def home(req):
    sid = space_of(req)
    uid = req.user["id"]
    kind = space_kind(sid)
    stats = {
        "memos": db.val("SELECT COUNT(*) FROM memos WHERE space_id=? AND status='active' AND kind!='state' AND trust!='low'", sid, default=0),
        "topics": db.val("SELECT COUNT(*) FROM topics WHERE space_id=?", sid, default=0),
        "instructions": db.val("SELECT COUNT(*) FROM memos WHERE space_id=? AND status='active' AND kind='instruction' AND trust!='low'", sid, default=0),
        "used_7d": db.val("SELECT COUNT(DISTINCT mu.memo_id) FROM memo_uses mu JOIN memos m ON m.id=mu.memo_id WHERE m.space_id=? AND mu.kind='used' AND mu.created_at>=?", sid, db.now() - 7 * 86400, default=0),
    }
    if kind == "team":
        feed = memo_rows("m.space_id=? AND m.status='active'", sid, limit=12)
        top = db.q("SELECT t.id, t.title, t.kind, COUNT(mu.id) AS refs, t.updated_at FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id "
                   "LEFT JOIN memo_uses mu ON mu.memo_id=mt.memo_id AND mu.kind IN ('recall','used') WHERE t.space_id=? GROUP BY t.id ORDER BY refs DESC, t.updated_at DESC LIMIT 6", sid)
        members = db.q("SELECT u.id, u.name, m.role, (SELECT COUNT(*) FROM memos x WHERE x.space_id=? AND x.author_id=u.id AND x.status='active') AS memos "
                       "FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY memos DESC, u.name", sid, sid)
        role = access.role_in(uid, sid)
        reports = admin_reports_for_team(sid) if role == "admin" else []
        return {"kind": "team", "stats": stats, "recent": feed, "top_topics": top, "members": members, "role": role, "reports": reports}
    states = memo_rows("m.space_id=? AND m.kind='state' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?)", sid, db.now(), limit=6)
    for s in states:
        se = db.one("SELECT platform, ended_at FROM sessions WHERE id=?", s["origin_session_id"]) if s["origin_session_id"] else None
        s["platform"] = se["platform"] if se else None
    events = [event_view(e) for e in db.q("SELECT * FROM ingest_events WHERE user_id=? AND space_id=? ORDER BY id DESC LIMIT 14", uid, sid)]
    cands = memo_rows("m.space_id=? AND m.trust='low' AND m.status='active'", sid, limit=8)
    for c in cands:
        se = db.one("SELECT platform, summary, ended_at FROM sessions WHERE id=?", c["origin_session_id"]) if c["origin_session_id"] else None
        c["session"] = se
    return {"kind": "personal", "stats": stats, "states": states, "events": events, "candidates": cands,
            "candidate_days": db.policy("retention")["candidate_days"]}


def admin_reports_for_team(sid):
    return db.q("SELECT r.id, r.memo_id, r.reason, r.created_at, u.name AS reporter, m.body FROM reports r JOIN users u ON u.id=r.reporter_id "
                "LEFT JOIN memos m ON m.id=r.memo_id WHERE r.space_id=? AND r.status='open' ORDER BY r.id DESC", sid)


# ── 메모 ────────────────────────────────────────────────────────────
@route("GET", "/api/memos")
def memos(req):
    sid = space_of(req)
    where, args = ["m.space_id=?"], [sid]
    qd = req.query
    status = qd.get("status") or "active"
    if status == "all":
        where.append("m.status!='deleted'")
    else:
        where.append("m.status=?")
        args.append(status)
    if qd.get("kind"):
        where.append("m.kind=?")
        args.append(qd["kind"])
    if qd.get("source") == "session":
        where.append("m.source='session'")
    elif qd.get("source") == "manual":
        where.append("m.source!='session'")
    if qd.get("trust"):
        where.append("m.trust=?")
        args.append(qd["trust"])
    if qd.get("project"):
        if qd["project"] == "__global__":
            where.append("m.scope='global'")
        else:
            where.append("m.project_key=?")
            args.append(qd["project"])
    if qd.get("author"):
        where.append("m.author_id=?")
        args.append(int(qd["author"]))
    if qd.get("q"):
        hits = retrieval.search([sid], qd["q"], None, limit=60, statuses=("active", "superseded", "duplicate", "expired", "dismissed") if status == "all" else (status,))
        ids = [h["id"] for h in hits]
        if not ids:
            return {"memos": [], "total": 0}
        where.append(f"m.id IN ({','.join('?' * len(ids))})")
        args += ids
        rows = memo_rows(" AND ".join(where), *args, limit=200)
        rows.sort(key=lambda m: ids.index(m["id"]))
        return {"memos": rows, "total": len(rows)}
    total = db.val(f"SELECT COUNT(*) FROM memos m WHERE {' AND '.join(where)}", *args, default=0)
    return {"memos": memo_rows(" AND ".join(where), *args, limit=int(qd.get("limit") or 200)), "total": total}


@route("POST", "/api/memos")
def memo_create(req):
    b = req.body
    sid = b.get("space_id")
    if sid and space_kind(int(sid)) == "team":
        raise BadRequest("팀 공간에는 직접 쓰지 않습니다. 내 메모를 검토한 뒤 '팀으로 공유'로 올리세요.")
    db.metric("cmd", "web:remember", user_id=req.user["id"])
    return pipeline.remember(req.user, b.get("text", ""), scope=b.get("scope"), project_key=mcp.normalize_project(b.get("project_key")),
                             kind=b.get("kind") or None)


@route("GET", r"/api/memos/(\d+)")
def memo_get(req, mid):
    m = access.get_memo(req.user, int(mid))
    rows = memo_rows("m.id=?", m["id"], limit=1)
    out = rows[0]
    out["entities"] = db.q("SELECT e.id, e.name, e.kind FROM entities e JOIN memo_entities me ON me.entity_id=e.id WHERE me.memo_id=?", m["id"])
    out["links"] = [dict(l, memo=db.one("SELECT id, body, status, kind FROM memos WHERE id=?", l["other"])) for l in db.q(
        "SELECT b_memo AS other, relation, 'out' AS dir FROM links WHERE a_memo=? UNION ALL SELECT a_memo AS other, relation, 'in' AS dir FROM links WHERE b_memo=?", m["id"], m["id"])]
    out["links"] = [l for l in out["links"] if l["memo"] and l["memo"]["status"] != "deleted"]
    # 대체 이력: 이전 판 → 이 메모 → 이후 판
    chain, cur = [], m
    while True:
        prev = db.one("SELECT id, body, status, created_at FROM memos WHERE superseded_by=? AND status='superseded'", cur["id"])
        if not prev or len(chain) > 20:
            break
        chain.insert(0, prev)
        cur = prev
    nxt, cur = [], m
    while cur.get("superseded_by") and len(nxt) < 20:
        n = db.one("SELECT id, body, status, created_at, superseded_by FROM memos WHERE id=?", cur["superseded_by"])
        if not n:
            break
        nxt.append(n)
        cur = n
    out["history"] = {"previous": chain, "next": nxt}
    out["uses"] = {r["kind"]: r["n"] for r in db.q("SELECT kind, COUNT(*) AS n FROM memo_uses WHERE memo_id=? GROUP BY kind", m["id"])}
    out["origin"] = db.one("SELECT m.id, s.name AS space FROM memos m JOIN spaces s ON s.id=m.space_id WHERE m.id=?", m["origin_memo_id"]) if m["origin_memo_id"] and m["author_id"] == req.user["id"] else None
    out["shared_to"] = db.q("SELECT m.id, s.name AS team, s.id AS space_id FROM memos m JOIN spaces s ON s.id=m.space_id WHERE m.origin_memo_id=? AND m.status='active'", m["id"])
    # 이 메모의 이전 판을 공유해 둔 팀 사본(아직 옛 내용). 작성자에게만 갱신 길을 보여 준다.
    out["stale_copies"] = pipeline.stale_team_copies(m["id"]) if m["author_id"] == req.user["id"] and m["status"] == "active" and out["space_kind"] == "personal" else []
    se = db.one("SELECT id, platform, summary, started_at FROM sessions WHERE id=? AND user_id=?", m["origin_session_id"], req.user["id"]) if m["origin_session_id"] else None
    out["session"] = se
    out["can_edit"] = m["author_id"] == req.user["id"] or access.role_in(req.user["id"], m["space_id"]) == "admin"
    return out


@route("PUT", r"/api/memos/(\d+)")
def memo_edit(req, mid):
    m = access.get_memo(req.user, int(mid), write=True)
    if m["status"] != "active":
        raise BadRequest("유효한 메모만 고칠 수 있습니다.")
    # 본문 없이 종류만 오면 제자리에서 종류만 바꾼다. 종류는 원문이 아니라 파생 정보다.
    if "text" not in req.body and req.body.get("kind"):
        return pipeline.set_kind(req.user, m["id"], req.body["kind"])
    # 절차의 '언제 쓰는지'도 파생 정보라 제자리에서 고친다(#16).
    if "text" not in req.body and "when" in req.body:
        return pipeline.set_when(req.user, m["id"], req.body["when"])
    # 원문은 고치지 않는다. 고친 내용을 새 메모로 저장하고 이전 판을 대체한다.
    return pipeline.remember(req.user, req.body.get("text", ""), space_id=m["space_id"], scope=m["scope"], project_key=m["project_key"],
                             kind=m["kind"], source=m["source"] if m["source"] != "session" else "manual",
                             origin_memo_id=m["origin_memo_id"], replaces_id=m["id"],
                             when=m["when_hint"] if m["kind"] == "procedure" else None)   # 사용자가 고친 '언제'를 새 판이 잃지 않게


@route("DELETE", r"/api/memos/(\d+)")
def memo_delete(req, mid):
    return pipeline.forget(req.user, int(mid))


@route("POST", r"/api/memos/(\d+)/confirm")
def memo_confirm(req, mid):
    return pipeline.confirm_candidate(req.user, int(mid))


@route("POST", r"/api/memos/(\d+)/dismiss")
def memo_dismiss(req, mid):
    return pipeline.dismiss_candidate(req.user, int(mid))


@route("POST", r"/api/events/(\d+)/undo")
def event_undo(req, eid):
    return pipeline.undo(req.user, int(eid))


@route("POST", "/api/import")
def import_(req):
    text = req.body.get("text") or ""
    if not text.strip():
        raise BadRequest("가져올 내용이 비어 있습니다.")
    return pipeline.import_text(req.user, text, mcp.normalize_project(req.body.get("project_key")), req.body.get("name"))


# ── 위키 ────────────────────────────────────────────────────────────
@route("GET", "/api/topics")
def topics(req):
    sid = space_of(req)
    rows = db.q("SELECT t.id, t.title, t.kind, t.project_key, t.updated_at, t.dirty, substr(t.summary,1,200) AS excerpt, "
                "SUM(m.status='active') AS memos, SUM(m.status='active' AND m.trust='low') AS unconfirmed, COUNT(DISTINCT CASE WHEN m.status='active' THEN m.author_id END) AS authors "
                "FROM topics t LEFT JOIN memo_topics mt ON mt.topic_id=t.id LEFT JOIN memos m ON m.id=mt.memo_id "
                "WHERE t.space_id=? GROUP BY t.id HAVING memos>0 ORDER BY t.updated_at DESC", sid)
    for t in rows:
        t["project"] = pipeline.short_project(t["project_key"])
        t["excerpt"] = re.sub(r"\s+", " ", re.sub(r"\[m:\d+\]|[#*`>]", "", t["excerpt"] or "")).strip()
    ents = db.q("SELECT e.id, e.name, e.kind, COUNT(*) AS n FROM entities e JOIN memo_entities me ON me.entity_id=e.id JOIN memos m ON m.id=me.memo_id AND m.status='active' "
                "WHERE e.space_id=? GROUP BY e.id HAVING n>=1 ORDER BY n DESC, e.name LIMIT 60", sid)
    inst = db.val("SELECT COUNT(*) FROM memos WHERE space_id=? AND kind='instruction' AND status='active' AND trust!='low'", sid, default=0)
    return {"topics": rows, "entities": ents, "instructions": inst, "suggestions": pipeline.topic_suggestions(sid),
            "kind": space_kind(sid), "role": access.role_in(req.user["id"], sid)}


@route("GET", r"/api/topics/(\d+)")
def topic_get(req, tid):
    t = db.one("SELECT * FROM topics WHERE id=?", int(tid))
    if not t:
        raise NotFound("주제를 찾을 수 없습니다.")
    access.require_read(req.user, t["space_id"])
    if t["dirty"] and not t["summary"]:
        pipeline.regenerate_topic(t["id"])
        t = db.one("SELECT * FROM topics WHERE id=?", t["id"])
    ms = memo_rows("m.id IN (SELECT memo_id FROM memo_topics WHERE topic_id=?) AND m.status IN ('active','superseded')", t["id"], limit=300,
                   order="m.status='active' DESC, m.created_at DESC")
    ids = [m["id"] for m in ms] or [0]
    marks = ",".join("?" * len(ids))
    related = db.q(f"SELECT t.id, t.title, COUNT(*) AS n FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE t.id!=? AND t.space_id=? AND mt.memo_id IN ("
                   f"SELECT b_memo FROM links WHERE a_memo IN ({marks}) UNION SELECT a_memo FROM links WHERE b_memo IN ({marks}) UNION "
                   f"SELECT me2.memo_id FROM memo_entities me1 JOIN memo_entities me2 ON me2.entity_id=me1.entity_id WHERE me1.memo_id IN ({marks})) "
                   f"GROUP BY t.id ORDER BY n DESC LIMIT 6", t["id"], t["space_id"], *ids, *ids, *ids)
    ents = db.q(f"SELECT e.id, e.name, e.kind, COUNT(*) AS n FROM entities e JOIN memo_entities me ON me.entity_id=e.id WHERE me.memo_id IN ({marks}) GROUP BY e.id ORDER BY n DESC LIMIT 12", *ids)
    refs = db.val(f"SELECT COUNT(*) FROM memo_uses WHERE kind IN ('recall','used') AND memo_id IN ({marks})", *ids, default=0)
    t["project"] = pipeline.short_project(t["project_key"])
    t["space_kind"] = space_kind(t["space_id"])
    t["space_name"] = db.val("SELECT name FROM spaces WHERE id=?", t["space_id"])
    return {"topic": t, "memos": ms, "related": related, "entities": ents, "refs": refs, "role": access.role_in(req.user["id"], t["space_id"])}


@route("POST", r"/api/topics/(\d+)/regenerate")
def topic_regen(req, tid):
    t = db.one("SELECT * FROM topics WHERE id=?", int(tid))
    if not t:
        raise NotFound("주제를 찾을 수 없습니다.")
    access.require_read(req.user, t["space_id"])
    return {"summary": pipeline.regenerate_topic(t["id"], req.user["id"])}


@route("PUT", r"/api/topics/(\d+)")
def topic_rename(req, tid):
    t = db.one("SELECT * FROM topics WHERE id=?", int(tid))
    if not t:
        raise NotFound("주제를 찾을 수 없습니다.")
    access.require_read(req.user, t["space_id"])
    if space_kind(t["space_id"]) == "team":
        access.require_team_admin(req.user, t["space_id"])
    title = (req.body.get("title") or "").strip()[:60]
    if not title:
        raise BadRequest("제목이 필요합니다.")
    db.update("topics", t["id"], title=title, updated_at=db.now())
    return {"ok": True}


@route("POST", "/api/topics/merge")
def topic_merge(req):
    return pipeline.merge_topics(req.user, int(req.body["keep"]), int(req.body["drop"]))


@route("GET", r"/api/entities/(\d+)")
def entity_get(req, eid):
    e = db.one("SELECT * FROM entities WHERE id=?", int(eid))
    if not e:
        raise NotFound("개체를 찾을 수 없습니다.")
    access.require_read(req.user, e["space_id"])
    return {"entity": e, "memos": memo_rows("m.id IN (SELECT memo_id FROM memo_entities WHERE entity_id=?) AND m.status='active'", e["id"])}


WEB_SEARCH_WINDOW = 60


@route("GET", "/api/search")
def search(req):
    q = req.query.get("q", "")
    # 웹 입력창은 타이핑하는 동안 계속 검색한다. 에이전트의 참조 지표(memo_uses, search)는 남기지 않고,
    # 검색 횟수는 사람의 검색 한 번(같은 사용자의 연속 입력은 WEB_SEARCH_WINDOW초 안에서 한 번)으로 센다.
    res = retrieval.recall(req.user, q, mcp.normalize_project(req.query.get("project")), limit=12, log=False)
    if not db.val("SELECT 1 FROM metrics WHERE kind='cmd' AND name='web:search' AND user_id=? AND created_at>=?",
                  req.user["id"], db.now() - WEB_SEARCH_WINDOW):
        db.metric("cmd", "web:search", user_id=req.user["id"])
    return res


# ── 에이전트(주입 미리보기) ─────────────────────────────────────────
@route("GET", "/api/agent/preview")
def agent_preview(req):
    pk = req.query.get("project") or None
    ctx = retrieval.build_context(req.user, pk, log=False)
    return ctx


@route("GET", "/api/agent/injections")
def agent_injections(req):
    rows = db.q("SELECT id, platform, session_ext_id, project_key, memo_ids, topic_ids, tokens, ms, created_at FROM injections WHERE user_id=? ORDER BY id DESC LIMIT 30", req.user["id"])
    for r in rows:
        r["memo_ids"], r["topic_ids"] = db.js(r["memo_ids"], []), db.js(r["topic_ids"], [])
        r["project"] = pipeline.short_project(r["project_key"])
        r["used"] = db.val("SELECT COUNT(DISTINCT memo_id) FROM memo_uses WHERE kind='used' AND user_id=? AND session_ext_id=?", req.user["id"], r["session_ext_id"], default=0) if r["session_ext_id"] else 0
    return {"injections": rows, "policy": db.policy("injection")}


# ── 세션 ────────────────────────────────────────────────────────────
@route("GET", "/api/sessions")
def session_list(req):
    rows = db.q("SELECT id, platform, ext_id, project_key, started_at, ended_at, status, transcript_chars, masked_count, summary, handoff FROM sessions "
                "WHERE user_id=? ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 100", req.user["id"])
    for r in rows:
        r["project"] = pipeline.short_project(r["project_key"])
        r["handoff"] = db.js(r["handoff"], None)
        r["candidates"] = db.val("SELECT COUNT(*) FROM memos WHERE origin_session_id=? AND source='session' AND kind!='state' AND status='active'", r["id"], default=0)
    return {"sessions": rows, "paused": bool(req.user["capture_paused"]), "policy": db.policy("capture"), "retention": db.policy("retention")}


@route("GET", r"/api/sessions/(\d+)")
def session_get(req, sid):
    s = db.one("SELECT * FROM sessions WHERE id=? AND user_id=?", int(sid), req.user["id"])
    if not s:
        raise NotFound("세션을 찾을 수 없습니다.")
    s["handoff"] = db.js(s["handoff"], None)
    s["project"] = pipeline.short_project(s["project_key"])
    s["memos"] = memo_rows("m.origin_session_id=? AND m.status!='deleted'", s["id"])
    inj = db.one("SELECT tokens, memo_ids, topic_ids, ms FROM injections WHERE user_id=? AND session_ext_id=? ORDER BY id LIMIT 1", req.user["id"], s["ext_id"])
    if inj:
        inj["memo_ids"], inj["topic_ids"] = db.js(inj["memo_ids"], []), db.js(inj["topic_ids"], [])
    s["injection"] = inj
    return s


@route("DELETE", r"/api/sessions/(\d+)")
def session_delete(req, sid):
    s = db.one("SELECT id FROM sessions WHERE id=? AND user_id=?", int(sid), req.user["id"])
    if not s:
        raise NotFound("세션을 찾을 수 없습니다.")
    # 세션에서 나온 미확인 후보와 진행 상태도 함께 지운다. 확인해서 정식이 된 메모는 남긴다.
    for m in db.q("SELECT id FROM memos WHERE origin_session_id=? AND (trust!='high') AND status='active'", s["id"]):
        db.ex("UPDATE memos SET status='deleted', updated_at=? WHERE id=?", db.now(), m["id"])
    db.ex("UPDATE memos SET origin_session_id=NULL WHERE origin_session_id=?", s["id"])
    sessions.drop_lines(s["id"])
    db.ex("DELETE FROM sessions WHERE id=?", s["id"])
    db.audit(req.user["id"], "session_delete", "session", s["id"])
    return {"ok": True}


# ── 팀 ──────────────────────────────────────────────────────────────
@route("POST", "/api/promote")
def promote(req):
    b = req.body
    ids = [int(i) for i in (b.get("memo_ids") or [])]
    if b.get("topic_id"):
        t = db.one("SELECT * FROM topics WHERE id=?", int(b["topic_id"]))
        if not t or t["space_id"] != access.personal_space_id(req.user["id"]):
            raise NotFound("주제를 찾을 수 없습니다.")
        ids = [r["memo_id"] for r in db.q("SELECT mt.memo_id FROM memo_topics mt JOIN memos m ON m.id=mt.memo_id WHERE mt.topic_id=? AND m.status='active' ORDER BY m.created_at", t["id"])]
    if not ids:
        raise BadRequest("올릴 메모가 없습니다.")
    return pipeline.promote(req.user, ids, int(b["team_space_id"]), ack=bool(b.get("ack")), dry_run=bool(b.get("dry_run")), note=b.get("note"))


@route("POST", "/api/reports")
def report_create(req):
    b = req.body
    m = access.get_memo(req.user, int(b["memo_id"]))
    reason = (b.get("reason") or "").strip()
    if len(reason) < 4:
        raise BadRequest("무엇이 문제인지 적어 주세요.")
    rid = db.insert("reports", memo_id=m["id"], space_id=m["space_id"], reporter_id=req.user["id"], reason=reason[:500],
                    share_content=1 if b.get("share_content") else 0, created_at=db.now())
    db.audit(req.user["id"], "report_create", "memo", m["id"], m["space_id"])
    return {"id": rid, "message": "신고했습니다."}


@route("POST", r"/api/reports/(\d+)/resolve")
def report_resolve(req, rid):
    r = db.one("SELECT * FROM reports WHERE id=?", int(rid))
    if not r:
        raise NotFound("신고를 찾을 수 없습니다.")
    if req.user["role"] != "operator":
        access.require_team_admin(req.user, r["space_id"])
    return admin.resolve_report(req.user, r["id"], req.body.get("action") or "dismiss")


# ── 훅 ──────────────────────────────────────────────────────────────
@route("POST", "/api/hooks/session-start")
def hook_start(req):
    b = req.body
    pk = mcp.normalize_project(b.get("project"))
    ctx = sessions.start(req.user, b.get("platform") or "claude-code", str(b.get("session_id") or ""), pk, b.get("cwd"))
    text = ctx["text"]
    if pk:
        text = (text or "# Conntext\n") + f"\n이 세션의 Conntext project: {pk}\n"
    minv = db.policy("clients").get("min_plugin_version")
    return {"context": text, "tokens": ctx["tokens"], "project": pk, "min_plugin_version": minv,
            "paused": bool(req.user["capture_paused"])}


@route("POST", "/api/hooks/session-upload")
def hook_upload(req):
    b = req.body
    return sessions.upload(req.user, b.get("platform") or "claude-code", str(b.get("session_id") or ""),
                           mcp.normalize_project(b.get("project")), b.get("cwd"), transcript=b.get("transcript"),
                           messages=b.get("messages"), final=b.get("final", True), reason=b.get("reason"), source_acl=b.get("source_acl"))


@route("POST", "/api/hooks/error")
def hook_error(req):
    db.metric("hook", "client-error:" + str(req.body.get("event", ""))[:30], user_id=req.user["id"], ok=False)
    return {"ok": True}


CLIENT_FILES = {
    "conntext.py": "plugin/scripts/conntext.py",
    "opencode/conntext.js": "opencode/conntext.js",
    **{f"skills/{n}.md": f"plugin/skills/{n}/SKILL.md" for n in ("remember", "recall", "resume", "handoff", "forget")},
}


# ── 운영 ────────────────────────────────────────────────────────────
@route("GET", "/api/admin/overview", roles=("operator", "auditor"))
def a_overview(req):
    return admin.overview()


@route("GET", "/api/admin/users", roles=("operator",))
def a_users(req):
    return {"users": admin.users()}


@route("POST", "/api/admin/users", roles=("operator",))
def a_user_create(req):
    return {"id": admin.create_user(req.user, req.body.get("email", ""), req.body.get("name", ""), req.body.get("role", "user"))}


@route("PUT", r"/api/admin/users/(\d+)", roles=("operator",))
def a_user_update(req, uid):
    kw = {}
    if "llm_budget_tokens" in req.body:
        kw["llm_budget_tokens"] = req.body["llm_budget_tokens"]
    return admin.update_user(req.user, int(uid), role=req.body.get("role"), name=req.body.get("name"), **kw)


@route("POST", r"/api/admin/users/(\d+)/offboard", roles=("operator",))
def a_offboard(req, uid):
    return admin.offboard(req.user, int(uid), req.body.get("personal", "delete"), req.body.get("reassign_to"))


@route("GET", "/api/admin/teams", roles=("operator",))
def a_teams(req):
    return {"teams": admin.teams()}


@route("POST", "/api/admin/teams", roles=("operator",))
def a_team_create(req):
    return {"id": admin.create_team(req.user, req.body.get("name", ""))}


@route("PUT", r"/api/admin/teams/(\d+)/members", roles=("operator",))
def a_team_member(req, sid):
    admin.set_member(req.user, int(sid), int(req.body["user_id"]), req.body.get("role"))
    return {"ok": True}


@route("GET", "/api/admin/policies", roles=("operator", "auditor"))
def a_policies(req):
    return {k: db.policy(k) for k in db.DEFAULT_POLICIES}


@route("PUT", r"/api/admin/policies/([a-z_]+)", roles=("operator",))
def a_policy_set(req, key):
    if key not in db.DEFAULT_POLICIES:
        raise NotFound("알 수 없는 정책입니다.")
    value = req.body.get("value")
    if key == "masking_rules":
        masking.validate(value)
    elif not isinstance(value, dict):
        raise BadRequest("정책 값은 객체여야 합니다.")
    else:
        value = {k: v for k, v in value.items() if k not in db.RETIRED_POLICY_KEYS.get(key, ())}
    db.set_policy(key, value, req.user["id"])
    db.audit(req.user["id"], "policy_update", "policy", key)
    return {"ok": True, "value": db.policy(key)}


@route("POST", "/api/admin/masking-test", roles=("operator",))
def a_mask_test(req):
    rules = req.body.get("rules")
    rules = db.policy("masking_rules") if rules is None else rules
    masking.validate(rules)            # 시험에서는 틀린 규칙을 400으로 알린다. 저장 경로는 건너뛴다.
    text, n = masking.mask(req.body.get("text", ""), rules)
    return {"text": text, "count": n}


@route("GET", "/api/admin/clients", roles=("operator",))
def a_clients(req):
    return admin.clients()


@route("GET", "/api/admin/pipeline", roles=("operator",))
def a_pipeline(req):
    return admin.pipeline_status()


@route("POST", "/api/admin/pipeline/reprocess", roles=("operator",))
def a_reprocess(req):
    return admin.reprocess(req.user, req.body.get("scope", "stale"))


@route("GET", "/api/admin/audit", roles=("operator", "auditor"))
def a_audit(req):
    limit = max(1, min(int(req.query.get("limit") or 200), 500))
    entries = admin.audit_log(limit + 1, req.query.get("action") or None, int(req.query.get("actor_id") or 0) or None,
                              int(req.query.get("before") or 0) or None)
    # 다음 페이지: 이 값을 before로 넘기면 더 오래된 기록이 온다. 더 없으면 null.
    nxt = entries[limit - 1]["id"] if len(entries) > limit else None
    entries = entries[:limit]
    return {"entries": entries, "next_before": nxt,
            "actions": [r["action"] for r in db.q("SELECT DISTINCT action FROM audit_log ORDER BY action")]}


@route("GET", "/api/admin/reports", roles=("operator",))
def a_reports(req):
    return {"reports": admin.reports(req.query.get("status") or "open")}


@route("POST", "/api/admin/breakglass", roles=("operator",))
def a_breakglass(req):
    return admin.break_glass(req.user, int(req.body["user_id"]), req.body.get("reason"), req.body.get("memo_id"))


@route("GET", r"/api/admin/trace/(\d+)", roles=("operator",))
def a_trace(req, mid):
    return admin.trace_memo(int(mid))


# ── HTTP ────────────────────────────────────────────────────────────
class Req:
    def __init__(self, user, query, body, headers):
        self.user, self.query, self.body, self.headers = user, query, body, headers


STATIC_ROUTES = {"/": "index.html", "/manual": "manual.html", "/app": "app/index.html", "/app/": "app/index.html"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Conntext/" + __version__

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _body(self):
        raw = self._raw
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except ValueError:
            raise BadRequest("JSON 형식이 아닙니다.")

    def _static(self, path):
        rel = STATIC_ROUTES.get(path) or path.lstrip("/")
        f = (config.WEB_DIR / rel).resolve()
        if not str(f).startswith(str(config.WEB_DIR.resolve())) or not f.is_file():
            return self._send(404, "<!doctype html><meta charset=utf-8><title>404</title><p>페이지를 찾을 수 없습니다. <a href='/'>처음으로</a>", "text/html; charset=utf-8")
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache = "public, max-age=31536000, immutable" if "/assets/fonts/" in str(f) else "no-cache"
        self._send(200, f.read_bytes(), ctype, {"Cache-Control": cache})

    def _mcp(self):
        try:
            user = auth_user(self.headers)
        except Unauthorized as e:
            return self._send(401, {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": str(e)}},
                              extra={"WWW-Authenticate": "Bearer"})
        if self.command != "POST":
            return self._send(405, {"error": "POST만 지원합니다."}, extra={"Allow": "POST"})
        try:
            msg = self._body()
        except BadRequest:
            return self._send(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
        sess = self.headers.get("X-Conntext-Session")
        if isinstance(msg, list):
            out = [r for r in (mcp.handle(user, m, sess) for m in msg) if r is not None]
            return self._send(200, out) if out else self._send(202, b"")
        res = mcp.handle(user, msg, sess)
        if res is None:
            return self._send(202, b"")
        self._send(200, res)

    def _dispatch(self):
        u = urllib.parse.urlsplit(self.path)
        path = u.path
        # 본문은 인증 전에 먼저 읽어 둔다. 읽지 않고 오류를 보내면 keep-alive 연결이 어긋난다.
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            self.close_connection = True
            return self._send(413, {"error": "요청이 너무 큽니다."}, extra={"Connection": "close"})
        self._raw = self.rfile.read(n) if n else b""
        if path == "/mcp":
            return self._mcp()
        if path.startswith("/client/"):
            # 클라이언트 배포: 장비에서 curl 한 줄로 내려받는다.
            rel = CLIENT_FILES.get(path[len("/client/"):])
            f = config.ROOT / rel if rel else None
            if not f or not f.is_file():
                return self._send(404, "not found\n", "text/plain; charset=utf-8")
            return self._send(200, f.read_bytes(), "text/plain; charset=utf-8", {"Cache-Control": "no-cache"})
        if not path.startswith("/api/"):
            if self.command not in ("GET", "HEAD"):
                return self._send(405, {"error": "허용되지 않는 메서드입니다."})
            return self._static(path)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        t0 = time.time()
        is_hook = path.startswith("/api/hooks/")
        try:
            for method, rx, fn, need_auth, roles in ROUTES:
                m = rx.match(path)
                if not m or method != self.command:
                    continue
                user = auth_user(self.headers) if need_auth else None
                if roles:
                    access.require_role(user, *roles, path=f"{self.command} {path}")
                body = self._body() if self.command in ("POST", "PUT", "DELETE") else {}
                if not isinstance(body, dict):
                    raise BadRequest("요청 본문은 JSON 객체여야 합니다.")
                return self._send(200, fn(Req(user, query, body, self.headers), *m.groups()))
            if any(rx.match(path) for _, rx, *_ in ROUTES):
                return self._send(405, {"error": "허용되지 않는 메서드입니다."})
            self._send(404, {"error": "없는 API입니다."})
        except Unauthorized as e:
            self._send(401, {"error": str(e)})
        except Forbidden as e:
            self._send(403, {"error": str(e)})
        except NotFound as e:
            self._send(404, {"error": str(e)})
        except (BadRequest, KeyError, ValueError, TypeError) as e:
            msg = str(e) if isinstance(e, BadRequest) else f"요청 형식이 올바르지 않습니다: {e}"
            self._send(400, {"error": msg})
        except Exception as e:
            if is_hook:
                db.metric("hook", path.rsplit("/", 1)[-1], (time.time() - t0) * 1000, ok=False)
            db.trace("api_error", f"{self.command} {path}: {type(e).__name__}: {e}")
            if self.server.verbose:
                traceback.print_exc()
            self._send(500, {"error": "서버 오류가 났습니다. 잠시 뒤 다시 시도하세요."})

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _dispatch


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    verbose = False


def make_server(host=None, port=None, verbose=False):
    srv = Server((host or config.HOST, config.PORT if port is None else port), Handler)
    srv.verbose = verbose
    return srv
