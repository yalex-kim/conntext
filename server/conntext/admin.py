"""운영자 모듈. 원칙: 운영자는 내용을 보지 않고 운영한다.
이 모듈의 조회는 예외 열람(break_glass)을 빼면 메타데이터와 집계만 돌려준다."""
import datetime, re, time
from . import access, config, db, jobs, llm
from .access import BadRequest, NotFound

DAY = 86400


def _pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    return round(s[min(len(s) - 1, int(len(s) * p))], 1)


def _lat(name, since):
    vals = [r["value"] for r in db.q("SELECT value FROM metrics WHERE kind='latency' AND name=? AND created_at>=?", name, since)]
    return {"n": len(vals), "p50": _pct(vals, 0.5), "p95": _pct(vals, 0.95)}


# 일별 집계는 서버 프로세스의 현지 시간대(TZ) 날짜로 묶는다. SQLite의 'localtime'과 파이썬 time 모듈은 같은 C 라이브러리
# 시간대 규칙을 쓰므로, 일광 절약 시간이 있는 시간대에서도 각 시각이 자기 날짜에 들어간다(23·25시간짜리 날도 맞다).
# 한계: 서버 시간대 하나로 묶는다. 사용자마다 다른 시간대로 보여 주지는 않는다.
LOCAL_DAY = "date(created_at, 'unixepoch', 'localtime')"


def _days(n):
    """최근 n일의 현지 자정(epoch 초) 목록. 오래된 날이 먼저다."""
    today = datetime.date.today()
    return [int(time.mktime((today - datetime.timedelta(days=i)).timetuple())) for i in range(n - 1, -1, -1)]


def _series(sql, days, *args):
    """sql은 d(현지 날짜 'YYYY-MM-DD')와 v를 돌려주고 마지막 인자로 시작 시각을 받는다."""
    rows = {r["d"]: r["v"] for r in db.q(sql, *args, days[0])}
    return [{"day": d, "value": rows.get(time.strftime("%Y-%m-%d", time.localtime(d)), 0) or 0} for d in days]


def overview(days=14):
    now = db.now()
    d7, d1 = now - 7 * DAY, now - DAY
    dl = _days(days)
    q = jobs.stats()
    hooks = db.one("SELECT COUNT(*) AS n, SUM(ok=0) AS fail FROM metrics WHERE kind='hook' AND created_at>=?", d1)
    llm_m = db.one("SELECT COUNT(*) AS n, SUM(ok=0) AS fail FROM metrics WHERE kind='llm' AND created_at>=?", d1)
    system = {
        "inject": _lat("inject", d7), "recall": _lat("recall", d7), "ingest": _lat("ingest", d7),
        "queue": q,
        "hook_calls_24h": hooks["n"] or 0, "hook_fail_24h": hooks["fail"] or 0,
        "llm_calls_24h": llm_m["n"] or 0, "llm_fail_24h": llm_m["fail"] or 0,
        "llm_provider": llm.provider(), "llm_model": llm.model_name(), "pipeline_version": config.PIPELINE_VERSION,
    }
    stages = db.q("SELECT name, COUNT(*) AS calls, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, AVG(value) AS ms "
                  "FROM metrics WHERE kind='llm' AND created_at>=? AND name NOT LIKE '%:budget_exceeded' GROUP BY name ORDER BY tin+tout DESC", d7)
    by_user = db.q("SELECT u.name, SUM(m.tokens_in+m.tokens_out) AS tokens FROM metrics m JOIN users u ON u.id=m.user_id "
                   "WHERE m.kind='llm' AND m.created_at>=? GROUP BY m.user_id ORDER BY tokens DESC LIMIT 8", d7)
    cost = {
        "stages": stages, "by_user": by_user,
        "tokens_7d": sum((s["tin"] or 0) + (s["tout"] or 0) for s in stages),
        "daily": _series(f"SELECT {LOCAL_DAY} AS d, SUM(tokens_in+tokens_out) AS v FROM metrics WHERE kind='llm' AND created_at>=? GROUP BY d", dl),
        "budget_exceeded_7d": db.val("SELECT COUNT(*) FROM metrics WHERE kind='llm' AND name LIKE '%:budget_exceeded' AND created_at>=?", d7, default=0),
    }
    ev = db.one("SELECT COUNT(*) AS n, SUM(undone_at IS NOT NULL) AS undone FROM ingest_events WHERE action='remember' AND created_at>=?", d7)
    manual = db.one("SELECT COUNT(*) AS n, SUM(status='deleted') AS deleted, SUM(status='superseded') AS superseded FROM memos WHERE source='manual' AND created_at>=?", d7)
    cand = db.one("SELECT COUNT(*) AS n, SUM(trust='high') AS promoted, SUM(status='expired') AS expired, SUM(status='dismissed') AS dismissed, "
                  "SUM(status='active' AND trust='low') AS pending FROM memos WHERE source='session'")
    srch = db.one("SELECT COUNT(*) AS n, SUM(ok=0) AS zero FROM metrics WHERE kind='search' AND created_at>=?", d7)
    injected = db.val("SELECT COUNT(DISTINCT memo_id) FROM memo_uses WHERE kind='inject' AND created_at>=?", d7, default=0)
    inj_used = db.val("SELECT COUNT(DISTINCT memo_id) FROM memo_uses WHERE kind='used' AND created_at>=? AND memo_id IN "
                      "(SELECT memo_id FROM memo_uses WHERE kind='inject' AND created_at>=?)", d7, d7, default=0)
    recalled = db.val("SELECT COUNT(DISTINCT memo_id) FROM memo_uses WHERE kind='recall' AND created_at>=?", d7, default=0)
    # 질문마다 넣은 메모(#12): 호출 수, 실제로 넣은 호출, 넣은 메모(세션·메모 쌍), 그중 같은 세션에서 답에 쓰였다고 알린 것
    pr = db.one("SELECT COUNT(*) AS calls, SUM(memo_ids!='[]') AS hit, AVG(CASE WHEN memo_ids!='[]' THEN tokens END) AS tok "
                "FROM prompt_injections WHERE created_at>=?", d7)
    pr_memos = db.val("SELECT COUNT(*) FROM (SELECT DISTINCT memo_id, session_ext_id FROM memo_uses WHERE kind='prompt' AND created_at>=?)", d7, default=0)
    # 쓰임 판정: 같은 사용자가 넣은 뒤 6시간 안에 그 메모를 답에 썼다고 알린 것. 세션 id가 같거나, 알림에 세션 id가 없을 때
    # (OpenCode의 MCP 호출에는 세션 id가 없다. 리뷰 PR #24)도 같은 질문의 쓰임으로 본다.
    pr_used = db.val("SELECT COUNT(*) FROM (SELECT DISTINCT p.memo_id, p.session_ext_id FROM memo_uses p JOIN memo_uses u "
                     "ON u.memo_id=p.memo_id AND u.user_id=p.user_id AND u.kind='used' AND u.created_at>=p.created_at AND u.created_at<=p.created_at+? "
                     "AND (u.session_ext_id=p.session_ext_id OR u.session_ext_id IS NULL OR u.session_ext_id='') "
                     "WHERE p.kind='prompt' AND p.created_at>=?)", 6 * 3600, d7, default=0)
    used = db.val("SELECT COUNT(DISTINCT memo_id) FROM memo_uses WHERE kind='used' AND created_at>=?", d7, default=0)
    by_rule = db.val("SELECT COUNT(*) FROM trace WHERE stage='analyze' AND result LIKE 'rule:%' AND created_at>=?", d7, default=0)
    by_llm = db.val("SELECT COUNT(*) FROM trace WHERE stage='analyze' AND result LIKE 'llm:%' AND created_at>=?", d7, default=0)
    quality = {
        "remember_7d": ev["n"] or 0, "undo_7d": ev["undone"] or 0,
        "manual_7d": manual["n"] or 0, "manual_deleted_7d": manual["deleted"] or 0, "manual_superseded_7d": manual["superseded"] or 0,
        "candidates": {k: cand[k] or 0 for k in ("n", "promoted", "expired", "dismissed", "pending")},
        "searches_7d": srch["n"] or 0, "zero_result_7d": srch["zero"] or 0,
        "prompt_calls_7d": pr["calls"] or 0, "prompt_hit_7d": pr["hit"] or 0, "prompt_avg_tokens": round(pr["tok"] or 0),
        "prompt_memos_7d": pr_memos, "prompt_used_7d": pr_used,
        "injected_memos_7d": injected, "injected_used_7d": inj_used, "recalled_memos_7d": recalled, "used_memos_7d": used,
        "analyze_by_rule_7d": by_rule, "analyze_by_llm_7d": by_llm,
        "masked_24h": (db.val("SELECT SUM(masked_count) FROM memos WHERE created_at>=?", d1, default=0)
                       + db.val("SELECT SUM(masked_count) FROM sessions WHERE started_at>=?", d1, default=0)),
    }
    active = db.val("SELECT COUNT(DISTINCT user_id) FROM (SELECT user_id FROM ingest_events WHERE created_at>=? "
                    "UNION ALL SELECT user_id FROM injections WHERE created_at>=?)", d7, d7, default=0)
    team_topics = db.q(
        "SELECT t.id, t.title, s.name AS team, COUNT(mu.id) AS refs FROM topics t JOIN spaces s ON s.id=t.space_id AND s.kind='team' "
        "JOIN memo_topics mt ON mt.topic_id=t.id LEFT JOIN memo_uses mu ON mu.memo_id=mt.memo_id AND mu.kind IN ('recall','used') AND mu.created_at>=? "
        "GROUP BY t.id ORDER BY refs DESC, t.updated_at DESC LIMIT 8", now - 30 * DAY)
    adoption = {
        "users": db.val("SELECT COUNT(*) FROM users WHERE deactivated_at IS NULL", default=0), "active_7d": active,
        "commands": db.q("SELECT name, COUNT(*) AS n FROM metrics WHERE kind='cmd' AND created_at>=? GROUP BY name ORDER BY n DESC", d7),
        "platforms": db.q("SELECT platform, COUNT(*) AS n FROM sessions WHERE started_at>=? GROUP BY platform ORDER BY n DESC", now - 30 * DAY),
        "team_topics": team_topics,
        "memos_daily": _series(f"SELECT {LOCAL_DAY} AS d, COUNT(*) AS v FROM memos WHERE source IN ('manual','import') AND created_at>=? GROUP BY d", dl),
        "injections_daily": _series(f"SELECT {LOCAL_DAY} AS d, COUNT(*) AS v FROM injections WHERE created_at>=? GROUP BY d", dl),
        "totals": {
            "memos": db.val("SELECT COUNT(*) FROM memos WHERE status='active'", default=0),
            "topics": db.val("SELECT COUNT(*) FROM topics", default=0),
            "sessions": db.val("SELECT COUNT(*) FROM sessions", default=0),
            "team_memos": db.val("SELECT COUNT(*) FROM memos m JOIN spaces s ON s.id=m.space_id WHERE s.kind='team' AND m.status='active'", default=0),
        },
    }
    reports_open = db.val("SELECT COUNT(*) FROM reports WHERE status='open'", default=0)
    return {"system": system, "cost": cost, "quality": quality, "adoption": adoption, "reports_open": reports_open,
            "alerts": alerts(system, cost, quality, reports_open), "generated_at": now}


def alerts(system, cost, quality, reports_open=0):
    out = []
    now = db.now()
    if system["queue"]["lag_seconds"] > 120:
        out.append({"level": "warn", "key": "queue_lag", "title": "처리 대기열 지연",
                    "text": f"가장 오래된 작업이 {system['queue']['lag_seconds']}초째 대기 중입니다. 메모가 바로 반영되지 않습니다."})
    if system["queue"]["failed_24h"]:
        out.append({"level": "warn", "key": "job_failed", "title": "실패한 작업", "text": f"최근 24시간 동안 작업 {system['queue']['failed_24h']}건이 3회 재시도 후 실패했습니다."})
    if system["hook_calls_24h"] >= 5 and system["hook_fail_24h"] / system["hook_calls_24h"] > 0.2:
        out.append({"level": "crit", "key": "hook_fail", "title": "훅 수신 실패 급증",
                    "text": f"24시간 훅 호출 {system['hook_calls_24h']}건 중 {system['hook_fail_24h']}건 실패. 클라이언트 업데이트로 연동이 깨졌을 수 있습니다."})
    if system["llm_calls_24h"] >= 5 and system["llm_fail_24h"] / system["llm_calls_24h"] > 0.3:
        out.append({"level": "warn", "key": "llm_fail", "title": "LLM 호출 실패", "text": f"24시간 호출 {system['llm_calls_24h']}건 중 {system['llm_fail_24h']}건 실패. 실패분은 규칙 기반으로 처리됐습니다."})
    base = db.val("SELECT SUM(masked_count) FROM memos WHERE created_at>=? AND created_at<?", now - 8 * DAY, now - DAY, default=0) / 7.0
    if quality["masked_24h"] > 10 and quality["masked_24h"] > 3 * max(base, 1):
        out.append({"level": "crit", "key": "masking_spike", "title": "마스킹 탐지 급증", "text": f"24시간 {quality['masked_24h']}건(평소 하루 {base:.0f}건). 비밀이 대량으로 들어오고 있습니다."})
    daily = [d["value"] for d in cost["daily"]]
    if len(daily) >= 4:
        avg = sum(daily[:-1]) / max(1, len(daily) - 1)
        if daily[-1] > 20000 and daily[-1] > 2.5 * max(avg, 1):
            out.append({"level": "warn", "key": "cost_anomaly", "title": "비용 이상치", "text": f"오늘 토큰 {daily[-1]:,}개. 최근 평균의 {daily[-1] / max(avg, 1):.1f}배입니다."})
    denied = db.val("SELECT COUNT(*) FROM metrics WHERE kind='authz' AND created_at>=?", now - DAY, default=0)
    if denied:
        out.append({"level": "crit", "key": "authz", "title": "권한 검사 실패", "text": f"24시간 동안 권한이 없는 공간·기능 접근 시도 {denied}건. 감사 로그를 확인하세요."})
    if reports_open:
        out.append({"level": "info", "key": "reports_open", "title": "처리 대기 중인 신고",
                    "text": f"팀 메모 신고 {reports_open}건이 처리를 기다립니다."})
    if system["inject"]["n"] >= 5 and system["inject"]["p95"] > 800:
        out.append({"level": "warn", "key": "inject_slow", "title": "세션 시작 주입 지연", "text": f"p95 {system['inject']['p95']}ms. 모든 세션 시작이 이만큼 느려집니다."})
    return out


# ── 사용자·팀 ───────────────────────────────────────────────────────
def users():
    rows = db.q("SELECT id, email, name, role, capture_paused, llm_budget_tokens, created_at, deactivated_at FROM users ORDER BY deactivated_at IS NOT NULL, name")
    now = db.now()
    for u in rows:
        pid = db.val("SELECT id FROM spaces WHERE kind='personal' AND owner_id=?", u["id"])
        u["memos"] = db.val("SELECT COUNT(*) FROM memos WHERE space_id=? AND status='active'", pid, default=0) if pid else 0
        u["last_active"] = db.val("SELECT MAX(created_at) FROM (SELECT created_at FROM ingest_events WHERE user_id=? UNION ALL SELECT created_at FROM injections WHERE user_id=?)", u["id"], u["id"])
        u["tokens_24h"] = db.val("SELECT SUM(tokens_in+tokens_out) FROM metrics WHERE kind='llm' AND user_id=? AND created_at>=?", u["id"], now - DAY, default=0)
        # 퇴사 처리 미리보기: 팀 공간에 쓴 메모(상태 무관, 넘겨줄 대상)와 개인 공간에서 실제로 지워질 메모(상태 무관).
        u["team_memos_authored"] = db.val("SELECT COUNT(*) FROM memos m JOIN spaces s ON s.id=m.space_id WHERE s.kind='team' AND m.author_id=?", u["id"], default=0)
        u["personal_memos_to_delete"] = db.val("SELECT COUNT(*) FROM memos WHERE space_id=?", pid, default=0) if pid else 0
        u["teams"] = [r["name"] for r in db.q("SELECT s.name FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=? AND s.kind='team'", u["id"])]
    return rows


EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def create_user(actor, email, name, role="user"):
    email, name = (email or "").strip(), (name or "").strip()
    if not EMAIL.match(email):
        raise BadRequest("이메일 형식이 올바르지 않습니다(예: name@company.com).")
    if not name:
        raise BadRequest("이름이 비어 있습니다.")
    if role not in ("user", "operator", "auditor"):
        raise BadRequest("역할이 올바르지 않습니다.")
    if db.val("SELECT 1 FROM users WHERE lower(email)=lower(?)", email):
        raise BadRequest("이미 있는 이메일입니다.")
    uid = db.insert("users", email=email, name=name, role=role, created_at=db.now())
    access.personal_space_id(uid)
    db.audit(actor["id"], "user_create", "user", uid, role=role)
    return uid


def update_user(actor, user_id, role=None, llm_budget_tokens=..., name=None):
    u = db.one("SELECT * FROM users WHERE id=?", user_id)
    if not u:
        raise NotFound("사용자를 찾을 수 없습니다.")
    ch = {}
    if role and role != u["role"]:
        if role not in ("user", "operator", "auditor"):
            raise BadRequest("역할이 올바르지 않습니다.")
        if u["role"] == "operator" and db.val("SELECT COUNT(*) FROM users WHERE role='operator' AND deactivated_at IS NULL") <= 1:
            raise BadRequest("마지막 운영자의 역할은 바꿀 수 없습니다.")
        ch["role"] = role
    if llm_budget_tokens is not ...:
        ch["llm_budget_tokens"] = llm_budget_tokens
    if name:
        ch["name"] = name
    if ch:
        db.update("users", user_id, **ch)
        db.audit(actor["id"], "user_update", "user", user_id, **{k: v for k, v in ch.items()})
    return ch


def offboard(actor, user_id, personal="delete", reassign_to=None):
    """퇴사·이동 처리. 토큰을 회수하고, 개인 공간은 삭제하거나 보관하며, 팀 문서의 담당자를 넘긴다."""
    u = db.one("SELECT * FROM users WHERE id=?", user_id)
    if not u:
        raise NotFound("사용자를 찾을 수 없습니다.")
    if u["id"] == actor["id"]:
        raise BadRequest("자기 자신은 처리할 수 없습니다.")
    now = db.now()
    db.ex("UPDATE tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now, user_id)
    team_n = 0
    if reassign_to:
        if not db.val("SELECT 1 FROM users WHERE id=? AND deactivated_at IS NULL", reassign_to):
            raise BadRequest("넘겨받을 사용자를 찾을 수 없습니다.")
        team_n = db.val("SELECT COUNT(*) FROM memos m JOIN spaces s ON s.id=m.space_id WHERE s.kind='team' AND m.author_id=?", user_id, default=0)
        db.ex("UPDATE memos SET author_id=? WHERE author_id=? AND space_id IN (SELECT id FROM spaces WHERE kind='team')", reassign_to, user_id)
    deleted = 0
    if personal == "delete":
        deleted = delete_personal_data(user_id)
    db.ex("DELETE FROM space_members WHERE user_id=? AND space_id IN (SELECT id FROM spaces WHERE kind='team')", user_id)
    db.update("users", user_id, deactivated_at=now)
    db.audit(actor["id"], "user_offboard", "user", user_id, personal=personal, reassigned_to=reassign_to, team_memos=team_n, deleted_memos=deleted)
    return {"ok": True, "deleted_memos": deleted, "reassigned_team_memos": team_n}


def delete_personal_data(user_id):
    """개인 공간의 메모·주제·세션·사용 기록을 실제로 지운다. 팀으로 올린 복사본은 팀의 것이라 남는다."""
    pid = db.val("SELECT id FROM spaces WHERE kind='personal' AND owner_id=?", user_id)
    n = 0
    if pid:
        ids = [r["id"] for r in db.q("SELECT id FROM memos WHERE space_id=?", pid)]
        n = len(ids)
        for i in range(0, len(ids), 400):
            chunk = ids[i:i + 400]
            marks = ",".join("?" * len(chunk))
            db.ex(f"DELETE FROM memos_fts WHERE rowid IN ({marks})", *chunk)
            for tbl, col in (("memo_topics", "memo_id"), ("memo_entities", "memo_id"), ("memo_uses", "memo_id"), ("links", "a_memo"), ("links", "b_memo"), ("trace", "memo_id")):
                db.ex(f"DELETE FROM {tbl} WHERE {col} IN ({marks})", *chunk)
            db.ex(f"UPDATE memos SET origin_memo_id=NULL WHERE origin_memo_id IN ({marks})", *chunk)
        db.ex("DELETE FROM memos WHERE space_id=?", pid)
        db.ex("DELETE FROM topics WHERE space_id=?", pid)
        db.ex("DELETE FROM entities WHERE space_id=?", pid)
        db.ex("DELETE FROM ingest_events WHERE space_id=?", pid)
    db.ex("DELETE FROM trace WHERE session_id IN (SELECT id FROM sessions WHERE user_id=?)", user_id)
    for r in db.q("SELECT id FROM sessions WHERE user_id=?", user_id):
        db.ex("DELETE FROM session_lines WHERE session_id=?", r["id"])
    db.ex("DELETE FROM sessions WHERE user_id=?", user_id)
    db.ex("DELETE FROM injections WHERE user_id=?", user_id)
    db.ex("DELETE FROM prompt_injections WHERE user_id=?", user_id)
    db.ex("DELETE FROM notifications WHERE user_id=?", user_id)
    return n


def teams():
    rows = db.q("SELECT id, name, created_at FROM spaces WHERE kind='team' ORDER BY name")
    for t in rows:
        t["members"] = db.q("SELECT u.id, u.name, u.email, m.role FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.role, u.name", t["id"])
        t["memos"] = db.val("SELECT COUNT(*) FROM memos WHERE space_id=? AND status='active'", t["id"], default=0)
        t["topics"] = db.val("SELECT COUNT(*) FROM topics WHERE space_id=?", t["id"], default=0)
        t["stale_topics"] = db.val("SELECT COUNT(*) FROM topics WHERE space_id=? AND updated_at<?", t["id"], db.now() - 90 * DAY, default=0)
        t["orphaned"] = db.val("SELECT COUNT(*) FROM memos m JOIN users u ON u.id=m.author_id WHERE m.space_id=? AND m.status='active' AND u.deactivated_at IS NOT NULL", t["id"], default=0)
    return rows


def create_team(actor, name):
    if not name.strip():
        raise BadRequest("팀 이름이 필요합니다.")
    sid = db.insert("spaces", kind="team", name=name.strip(), owner_id=None, created_at=db.now())
    db.audit(actor["id"], "team_create", "space", sid, sid, name=name)
    return sid


def set_member(actor, space_id, user_id, role):
    if not db.val("SELECT 1 FROM spaces WHERE id=? AND kind='team'", space_id):
        raise NotFound("팀을 찾을 수 없습니다.")
    if role is None:
        db.ex("DELETE FROM space_members WHERE space_id=? AND user_id=?", space_id, user_id)
    else:
        if role not in ("member", "admin"):
            raise BadRequest("역할이 올바르지 않습니다.")
        db.ex("INSERT INTO space_members(space_id,user_id,role) VALUES(?,?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET role=excluded.role", space_id, user_id, role)
    db.audit(actor["id"], "team_member", "space", space_id, space_id, user_id=user_id, role=role)


# ── 연동·파이프라인·감사 ────────────────────────────────────────────
def _vt(v):
    try:
        return tuple(int(x) for x in (v or "0").split(".")[:3])
    except ValueError:
        return (0,)


def clients():
    minv = db.policy("clients").get("min_plugin_version", config.MIN_PLUGIN_VERSION)
    rows = db.q("SELECT t.id, t.prefix, t.label, t.kind, t.client_platform, t.client_version, t.created_at, t.last_used_at, t.revoked_at, "
                "u.name AS user_name, u.email FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.kind='client' ORDER BY t.revoked_at IS NOT NULL, t.last_used_at DESC")
    for r in rows:
        r["outdated"] = bool(r["client_version"]) and _vt(r["client_version"]) < _vt(minv)
    return {"min_plugin_version": minv, "tokens": rows}


def pipeline_status():
    return {
        "current": config.PIPELINE_VERSION, "llm_provider": llm.provider(), "llm_model": llm.model_name(),
        "embed_provider": config.EMBED_PROVIDER,
        "memos": db.q("SELECT COALESCE(pipeline_version,'없음') AS version, COUNT(*) AS n FROM memos WHERE status='active' GROUP BY 1"),
        "topics": db.q("SELECT COALESCE(pipeline_version,'없음') AS version, COUNT(*) AS n FROM topics GROUP BY 1"),
        "dirty_topics": db.val("SELECT COUNT(*) FROM topics WHERE dirty=1", default=0),
        "queue": jobs.stats(),
        "recent_jobs": db.q("SELECT id, kind, status, attempts, created_at, finished_at, substr(error,1,160) AS error FROM jobs ORDER BY id DESC LIMIT 12"),
    }


def reprocess(actor, scope="stale"):
    """파이프라인 버전이 바뀐 뒤, 옛 버전으로 만든 결과물만 골라 다시 만든다."""
    n = 0
    if scope in ("stale", "all"):
        cond = "" if scope == "all" else "AND (pipeline_version IS NULL OR pipeline_version!=?)"
        args = () if scope == "all" else (config.PIPELINE_VERSION,)
        for m in db.q(f"SELECT id FROM memos WHERE status='active' {cond}", *args):
            jobs.enqueue("reprocess_memo", {"memo_id": m["id"]}, dedupe=True)
            n += 1
        for t in db.q(f"SELECT id FROM topics WHERE 1=1 {cond}", *args):
            jobs.enqueue("topic_summary", {"topic_id": t["id"]}, dedupe=True)
            n += 1
    elif scope == "topics":
        for t in db.q("SELECT id FROM topics"):
            jobs.enqueue("topic_summary", {"topic_id": t["id"]}, dedupe=True)
            n += 1
    db.audit(actor["id"], "reprocess", "pipeline", config.PIPELINE_VERSION, scope=scope, jobs=n)
    return {"enqueued": n}


def audit_log(limit=200, action=None, actor_id=None, before=None):
    """최신순. before(감사 로그 id)를 주면 그보다 오래된 기록부터 limit건을 준다."""
    sql = "SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE 1=1"
    args = []
    if action:
        sql += " AND a.action=?"
        args.append(action)
    if actor_id:
        sql += " AND a.actor_id=?"
        args.append(actor_id)
    if before:
        sql += " AND a.id<?"
        args.append(before)
    rows = db.q(sql + " ORDER BY a.id DESC LIMIT ?", *args, limit)
    for r in rows:
        r["detail"] = db.js(r["detail"], {})
        r["space_name"] = db.val("SELECT name FROM spaces WHERE id=?", r["space_id"]) if r["space_id"] else None
    return rows


def trace_memo(memo_id):
    """메모 하나가 거친 단계. 본문은 돌려주지 않는다."""
    m = db.one("SELECT id, space_id, author_id, kind, source, trust, scope, status, superseded_by, origin_memo_id, origin_session_id, "
               "masked_count, pipeline_version, use_count, created_at, updated_at, length(body) AS body_chars FROM memos WHERE id=?", memo_id)
    if not m:
        raise NotFound("메모를 찾을 수 없습니다.")
    m["space"] = db.one("SELECT kind, name FROM spaces WHERE id=?", m["space_id"])
    return {
        "memo": m,
        "stages": db.q("SELECT stage, result, ms, created_at FROM trace WHERE memo_id=? ORDER BY id", memo_id),
        "topics": db.q("SELECT t.id, length(t.summary) AS summary_chars, t.pipeline_version, t.dirty FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", memo_id),
        "events": db.q("SELECT action, created_at, undone_at FROM ingest_events WHERE memo_id=? ORDER BY id", memo_id),
        "uses": db.q("SELECT kind, COUNT(*) AS n, MAX(created_at) AS last FROM memo_uses WHERE memo_id=? GROUP BY kind", memo_id),
    }


def reports(status="open"):
    rows = db.q("SELECT r.*, u.name AS reporter, s.name AS space_name, s.kind AS space_kind FROM reports r JOIN users u ON u.id=r.reporter_id "
                "JOIN spaces s ON s.id=r.space_id WHERE r.status=? ORDER BY r.id DESC LIMIT 100", status)
    for r in rows:
        # 신고자가 내용 공유에 동의했거나 팀 공간의 항목일 때만 본문을 보여 준다.
        r["content"] = None
        if r["memo_id"] and (r["share_content"] or r["space_kind"] == "team"):
            r["content"] = db.val("SELECT body FROM memos WHERE id=?", r["memo_id"])
    return rows


def resolve_report(actor, report_id, action):
    r = db.one("SELECT * FROM reports WHERE id=?", report_id)
    if not r:
        raise NotFound("신고를 찾을 수 없습니다.")
    if action == "remove" and r["memo_id"]:
        sp = db.one("SELECT kind FROM spaces WHERE id=?", r["space_id"])
        if sp["kind"] != "team":
            raise BadRequest("개인 공간의 메모는 운영자가 지울 수 없습니다.")
        db.ex("UPDATE memos SET status='deleted', updated_at=? WHERE id=?", db.now(), r["memo_id"])
        from . import pipeline
        for tid in pipeline._topics_of(r["memo_id"]):
            pipeline.mark_dirty(tid)
    db.update("reports", report_id, status="resolved", resolved_by=actor["id"], resolved_at=db.now())
    db.audit(actor["id"], "report_resolve", "report", report_id, r["space_id"], resolution=action, memo_id=r["memo_id"])
    return {"ok": True}


def break_glass(actor, user_id, reason, memo_id=None):
    """개인 공간 내용 예외 열람. 사유 필수, 감사 로그 기록, 당사자 통지."""
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise BadRequest("열람 사유를 10자 이상 적어야 합니다.")
    u = db.one("SELECT id, name FROM users WHERE id=?", user_id)
    if not u:
        raise NotFound("사용자를 찾을 수 없습니다.")
    pid = access.personal_space_id(user_id)
    if memo_id:
        rows = db.q("SELECT id, body, kind, source, trust, status, created_at FROM memos WHERE id=? AND space_id=?", memo_id, pid)
    else:
        rows = db.q("SELECT id, body, kind, source, trust, status, created_at FROM memos WHERE space_id=? AND status!='deleted' ORDER BY id DESC LIMIT 50", pid)
    db.audit(actor["id"], "break_glass", "user", user_id, pid, reason=reason, memo_id=memo_id, rows=len(rows))
    db.insert("notifications", user_id=user_id, created_at=db.now(),
              body=f"운영자 {actor['name']} 님이 내 공간의 메모 {len(rows)}건을 열람했습니다. 사유: {reason}")
    return {"user": u, "memos": rows, "notified": True}
