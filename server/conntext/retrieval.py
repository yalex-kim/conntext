"""검색, 세션 시작 주입, 이어받기."""
import math, re, time
from . import access, db, embed

TIER_WEIGHT = {"mine": 1.0, "team": 0.95, "state": 0.85, "candidate": 0.6}
TIER_LABEL = {"mine": "내 메모", "team": "팀 지식", "state": "진행 상태", "candidate": "세션 자동 추출"}


def est_tokens(text):
    """토큰 수 추정. 한글은 글자당 약 1토큰, 영문은 4글자당 1토큰으로 본다."""
    if not text:
        return 0
    ko = len(re.findall(r"[\u3131-\u318e\uac00-\ud7a3]", text))
    return int(math.ceil(ko * 1.0 + (len(text) - ko) / 3.6))


def tier_of(memo, space_kind):
    if space_kind == "team":
        return "team"
    if memo["kind"] == "state":
        return "state"
    if memo["trust"] == "low":
        return "candidate"
    return "mine"


def _fts_query(text):
    toks = [t for t in re.findall(r"[\w\uac00-\ud7a3]+", text) if len(t) >= 3]
    return " OR ".join('"' + t.replace('"', "") + '"' for t in toks[:16])


def search(space_ids, query, project_key=None, limit=8, statuses=("active",), exclude_ids=(), min_score=0.12, kinds=None):
    """하이브리드 검색: 임베딩 유사도 + 키워드(FTS) 가점, 신뢰 등급·범위 가중."""
    if not space_ids or not query.strip():
        return []
    qv = embed.embed(query)
    marks = ",".join("?" * len(space_ids))
    smarks = ",".join("?" * len(statuses))
    rows = db.q(f"SELECT m.*, s.kind AS space_kind, s.name AS space_name, u.name AS author_name FROM memos m "
                f"JOIN spaces s ON s.id=m.space_id JOIN users u ON u.id=m.author_id "
                f"WHERE m.space_id IN ({marks}) AND m.status IN ({smarks})", *space_ids, *statuses)
    fts_rank = {}
    fq = _fts_query(query)
    if fq:
        # 키워드 후보도 아래에서 점수를 매길 메모와 같은 조건(공간·상태·종류·제외 id) 안에서만 뽑는다.
        # 서버 전체를 놓고 상위 40건을 뽑으면, 점수를 받지 못할 메모가 자리를 차지해 내 메모의 가점이 사라진다.
        where, args = [f"m.space_id IN ({marks})", f"m.status IN ({smarks})"], [*space_ids, *statuses]
        if kinds:
            where.append(f"m.kind IN ({','.join('?' * len(kinds))})")
            args += list(kinds)
        if exclude_ids:
            where.append(f"m.id NOT IN ({','.join('?' * len(exclude_ids))})")
            args += list(exclude_ids)
        try:
            for i, r in enumerate(db.q("SELECT f.rowid FROM memos_fts f JOIN memos m ON m.id=f.rowid "
                                       f"WHERE memos_fts MATCH ? AND {' AND '.join(where)} "
                                       "ORDER BY bm25(memos_fts) LIMIT 40", fq, *args)):
                fts_rank[r["rowid"]] = i
        except Exception as e:
            # 질의가 깨져도 검색은 유사도만으로 계속한다. 다만 조용히 품질이 떨어지지 않게 기록을 남긴다.
            db.trace("fts_error", f"{type(e).__name__}: {e}")
    out = []
    for m in rows:
        if m["id"] in exclude_ids or (kinds and m["kind"] not in kinds):
            continue
        cos = embed.cosine(qv, embed.unpack(m["embedding"])) if m["embedding"] else 0.0
        kw = 1.0 / (1.0 + 0.4 * fts_rank[m["id"]]) if m["id"] in fts_rank else 0.0
        base = 0.7 * max(cos, 0.0) + 0.3 * kw
        tier = tier_of(m, m["space_kind"])
        score = base * TIER_WEIGHT[tier]
        if m["space_kind"] == "team" and m["origin_memo_id"]:
            from .pipeline import origin_state
            m["origin_state"] = origin_state(m)
            if m["origin_state"]:
                score *= 0.8   # 작성자가 원본을 고쳤거나 지웠다. 낡았을 수 있는 내용은 한 단계 뒤로.
        if m["scope"] == "project":
            score *= 1.15 if (project_key and m["project_key"] == project_key) else (0.55 if project_key else 0.9)
        if score >= min_score:
            m.pop("embedding", None)
            m.update(score=round(score, 4), cos=round(cos, 4), kw=round(kw, 4), tier=tier)
            out.append(m)
    out.sort(key=lambda r: -r["score"])
    return out[:limit]


def _memo_view(m):
    topics = db.q("SELECT t.id, t.title FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", m["id"])
    return {
        "id": m["id"], "tier": m["tier"], "label": TIER_LABEL[m["tier"]], "space": m["space_name"],
        "author": m["author_name"], "kind": m["kind"], "scope": m["scope"], "project_key": m["project_key"],
        "created_at": m["created_at"], "title": m["title"], "body": m["body"], "score": m["score"],
        "origin_state": m.get("origin_state"), "when": m.get("when_hint"),
        "topics": topics,
    }


def drop_shadowed(hits):
    """내가 팀에 올린 사본이 원본(또는 원본의 지금 판)과 함께 나오면 내 것만 남긴다."""
    from .pipeline import current_of
    mine = {m["id"] for m in hits}
    def shadowed(m):
        if not m["origin_memo_id"]:
            return False
        if m["origin_memo_id"] in mine:
            return True
        head = current_of(m["origin_memo_id"]) if m.get("origin_state") == "changed" else None
        return bool(head and head["id"] in mine)
    return [m for m in hits if not shadowed(m)]


PROMPT_MIN_CHARS = 6
# 질문의 내용어를 뽑을 때 떼는 조사·어미와, 어느 질문에나 나와 관련도를 말해 주지 않는 말.
_SUFFIXES = sorted("에서는 에서 으로는 으로 에게 에는 이랑 하려고 하려면 하는데 해서 해줘 해야 했지 했어 됐어 돼요 돼 되나 될까 인데 이야 이지 은 는 이 가 을 를 에 의 도 로 와 과 랑 만 좀 지".split(), key=len, reverse=True)
_STOP = set("""어디 언제 얼마 무엇 뭐야 뭐지 어떻게 왜 이거 그거 저거 여기 거기 이번 지금 다시 그냥 먼저 혹시 정도 하는 하는데 해줘 알려 알려줘 고쳐 바꿔 돌려 만들어 보여 정리 확인
  추가 수정 작업 방법 문제 파일 함수 코드 테스트 이름 오타 변수 질문 답변 설명 내용 부분 관련 경우 가능 필요 사용
  될까 할까 하자 할게 이어서 뭐였 잡았 했던 있어 없어 같아 싶어 거야 건가 맞아 the and for with this that what how why please fix run make add""".split())


def prompt_terms(text):
    """질문의 내용어. '스테이징에 배포하려고' → ['스테이징', '배포']. 영문·숫자 토큰은 그대로(소문자) 쓴다."""
    out = []
    for tok in re.findall(r"[A-Za-z0-9_.\-]+|[가-힣]+", text):
        t = tok.lower().strip("._-")
        if re.match(r"[가-힣]", t):
            for suf in _SUFFIXES:
                if t.endswith(suf) and len(t) - len(suf) >= 2:
                    t = t[:-len(suf)]
                    break
            for suf in ("하려", "하는", "했던", "하던", "해", "하"):
                if t.endswith(suf) and len(t) - len(suf) >= 2:
                    t = t[:-len(suf)]
                    break
        if len(t) < 2 or t in _STOP or t in out:
            continue
        out.append(t)
    return out[:12]


def prompt_relevance(terms, m):
    """(겹친 내용어 수, 관련도). 관련도 = 0.6 × 질문 내용어 가운데 메모에 있는 비율 + 0.4 × 검색 점수."""
    body = (m["body"] + " " + (m.get("title") or "") + " " + (m.get("when_hint") or "")).lower()
    hit = [t for t in terms if t in body]
    cover = len(hit) / len(terms) if terms else 0.0
    return len(hit), round(0.6 * cover + 0.4 * min(1.0, m["score"]), 4)
PROMPT_MEMO_CHARS = 400


def _prompt_tag(m):
    if m["tier"] == "team":
        note = {"changed": " · 원본이 바뀜", "deleted": " · 원본이 삭제됨"}.get(m.get("origin_state"), "")
        tag = f"[팀 지식 · {m['author_name']}{note}]"
    elif m["tier"] == "candidate":
        tag = "[세션 자동 추출·미확인]"
    else:
        tag = "[내 메모]"
    if m["kind"] == "procedure":
        tag += " 절차" + (f" · 언제: {m['when_hint']}" if m.get("when_hint") else "")
    return tag


def prompt_context(user, prompt, project_key=None, session_ext_id=None, platform=None, log=True):
    """질문 하나에 관련도가 충분히 높은 메모만 넣는다(#12). 넣을 것이 없으면 빈 문자열이다.

    n-gram 임베딩은 의미 검색이 아니라서, 점수만 보면 엉뚱한 메모가 질문마다 끼어든다. 그래서 질문의 단어가
    메모에 실제로 있어야(키워드 일치) 하고 점수도 기준 이상이어야 한다. 넣지 않는 것이 잘못 넣는 것보다 낫다."""
    t0 = time.time()
    pol = db.policy("prompt_recall")
    out = {"text": "", "memo_ids": [], "tokens": 0, "items": [], "enabled": bool(pol.get("enabled")) and not user.get("prompt_recall_off")}
    q = re.sub(r"<private>[\s\S]*?</private>", " ", prompt or "", flags=re.I).strip()
    if not out["enabled"] or len(q) < PROMPT_MIN_CHARS or q.startswith("/"):
        return out
    q = q[:2000]
    uid = user["id"]
    seen = set()
    if session_ext_id:
        seen = {r["memo_id"] for r in db.q("SELECT DISTINCT memo_id FROM memo_uses WHERE user_id=? AND session_ext_id=? AND kind IN ('inject','prompt')",
                                           uid, session_ext_id)}
    max_n, budget = int(pol.get("max_memos") or 0), int(pol.get("token_budget") or 0)
    terms = prompt_terms(q)
    if not terms:
        return out
    hits = search(access.space_ids(uid), q, project_key, limit=24, kinds=("knowledge", "procedure"), exclude_ids=tuple(seen), min_score=0.0)
    # 키워드 일치: 질문의 내용어가 메모에 둘 이상 있어야 한다. 내용어가 하나뿐인 질문은 그 말이 영문 식별자(4자 이상)일 때만.
    # 점수: 그 위에 관련도(내용어 비율 + 검색 점수)가 min_score 이상이어야 한다.
    need = 2 if len(terms) > 1 else (1 if re.match(r"[a-z0-9_.\-]{4,}$", terms[0]) else 99)
    ranked = []
    for m in drop_shadowed(hits):
        n_hit, rel = prompt_relevance(terms, m)
        if n_hit >= need and rel >= float(pol.get("min_score") or 0):
            m["relevance"] = rel
            ranked.append(m)
    hits = sorted(ranked, key=lambda m: -m["relevance"])
    head = "# Conntext: 이 질문과 관련 있어 보이는 메모\n"
    foot = "\n관련 없으면 무시한다. 답에 쓴 메모는 `mark_used`로 알린다. [세션 자동 추출·미확인] 메모를 근거로 쓸 때는 미확인임을 밝힌다.\n"
    used = est_tokens(head) + est_tokens(foot)
    blocks = []
    for m in hits:
        if len(blocks) >= max_n:
            break
        body = m["body"].strip()
        body = body[:PROMPT_MEMO_CHARS] + ("…" if len(body) > PROMPT_MEMO_CHARS else "")
        block = f"{_prompt_tag(m)} m:{m['id']}\n{body}"
        c = est_tokens(block) + 2
        if budget and used + c > budget:
            continue
        blocks.append(block)
        used += c
        out["memo_ids"].append(m["id"])
        out["items"].append({"memo_id": m["id"], "tier": m["tier"], "kind": m["kind"], "relevance": m["relevance"], "text": body, "tokens": c})
    if blocks:
        out["text"] = head + "\n\n".join(blocks) + "\n" + foot
        out["tokens"] = used
    ms = (time.time() - t0) * 1000
    if log:
        now = db.now()
        db.insert("prompt_injections", user_id=uid, platform=platform, session_ext_id=session_ext_id, project_key=project_key,
                  memo_ids=out["memo_ids"], tokens=out["tokens"], ms=ms, created_at=now)
        for mid in out["memo_ids"]:
            db.insert("memo_uses", memo_id=mid, user_id=uid, kind="prompt", session_ext_id=session_ext_id, created_at=now)
        db.metric("latency", "prompt", ms, user_id=uid)
    out["ms"] = round(ms, 1)
    return out


def recall(user, query, project_key=None, session_ext_id=None, limit=6, log=True):
    """log=False면 사용 기록(memo_uses)과 검색 지표를 남기지 않는다. 사람이 웹에서 타이핑하며 보는 검색용이다."""
    t0 = time.time()
    sids = access.space_ids(user["id"])
    hits = drop_shadowed(search(sids, query, project_key, limit=limit + 4))[:limit]
    results = [_memo_view(m) for m in hits]
    topic_ids, topics = [], []
    for r in results:
        for t in r["topics"]:
            if t["id"] not in topic_ids:
                topic_ids.append(t["id"])
    for tid in topic_ids[:3]:
        t = db.one("SELECT t.id, t.title, t.summary, t.kind, s.kind AS space_kind, s.name AS space FROM topics t JOIN spaces s ON s.id=t.space_id WHERE t.id=?", tid)
        if t and t["summary"]:
            topics.append(t)
    ms = (time.time() - t0) * 1000
    if log:
        now = db.now()
        for r in results:
            db.insert("memo_uses", memo_id=r["id"], user_id=user["id"], kind="recall", session_ext_id=session_ext_id, created_at=now)
        db.metric("latency", "recall", ms, user_id=user["id"])
        db.metric("search", "recall", len(results), user_id=user["id"], ok=bool(results))
    return {"query": query, "results": results, "topics": topics, "ms": round(ms, 1)}


def mark_used(user, memo_ids, session_ext_id=None):
    """에이전트가 답에 실제로 쓴 메모를 기록한다. 세션 추출 후보는 충분히 쓰이면 정식 메모로 올린다."""
    need = db.policy("retention").get("candidate_promote_uses", 2)
    promoted, now = [], db.now()
    sids = set(access.space_ids(user["id"]))
    for mid in memo_ids:
        m = db.one("SELECT * FROM memos WHERE id=?", mid)
        if not m or m["space_id"] not in sids:
            continue
        db.insert("memo_uses", memo_id=mid, user_id=user["id"], kind="used", session_ext_id=session_ext_id, created_at=now)
        db.ex("UPDATE memos SET use_count=use_count+1, last_used_at=? WHERE id=?", now, mid)
        if m["trust"] == "low" and m["status"] == "active" and m["use_count"] + 1 >= need and m["author_id"] == user["id"]:
            db.ex("UPDATE memos SET trust='high', updated_at=? WHERE id=?", now, mid)
            db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=mid, action="auto_promoted",
                      detail={"uses": m["use_count"] + 1}, created_at=now)
            db.trace("promote", "auto", memo_id=mid)
            promoted.append(mid)
    return {"marked": len(memo_ids), "promoted": promoted}


def latest_state(user_id, project_key=None):
    pid = access.personal_space_id(user_id)
    base = ("SELECT m.*, se.platform, se.ended_at AS session_ended FROM memos m LEFT JOIN sessions se ON se.id=m.origin_session_id "
            "WHERE m.space_id=? AND m.kind='state' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) ")
    if project_key:
        return db.one(base + "AND m.project_key=? ORDER BY m.created_at DESC LIMIT 1", pid, db.now(), project_key)
    return db.one(base + "ORDER BY m.created_at DESC LIMIT 1", pid, db.now())


def resume(user, project_key=None):
    st = latest_state(user["id"], project_key)
    other = None
    if not st and project_key:
        other = latest_state(user["id"], None)
    related = []
    if st:
        related = [_memo_view(m) for m in search(access.space_ids(user["id"]), st["body"], project_key, limit=4, exclude_ids=(st["id"],), kinds=("knowledge", "procedure", "instruction"))]
    return {"project_key": project_key, "state": _state_view(st), "other_project_state": _state_view(other), "related": related}


def _state_view(st):
    if not st:
        return None
    return {"id": st["id"], "body": st["body"], "project_key": st["project_key"], "created_at": st["created_at"],
            "platform": st.get("platform"), "source": st["source"]}


def instruction_usage(user_id, project_key=None):
    """세션 시작 때 항상 들어갈 지시·선호(전체 범위 + 이 저장소 범위)의 글자 수와 상한(#17).
    순서는 주입 순서와 같다: 저장소 범위가 먼저, 그 안에서 최근 것이 먼저."""
    pid = access.personal_space_id(user_id)
    scope = "(m.scope='global' OR m.project_key=?)" if project_key else "m.scope='global'"
    rows = db.q(f"SELECT m.id, m.body, m.scope, m.project_key FROM memos m WHERE m.space_id=? AND m.kind='instruction' AND m.status='active' "
                f"AND m.trust='high' AND {scope} ORDER BY m.scope='project' DESC, m.created_at DESC",
                pid, *((project_key,) if project_key else ()))
    for r in rows:
        r["chars"] = len(r["body"])
    pol = db.policy("injection")
    return {"chars": sum(r["chars"] for r in rows), "limit": int(pol.get("instruction_chars") or 0),
            "max_count": int(pol["max_instructions"] if pol.get("max_instructions") is not None else 12), "items": rows}


def build_context(user, project_key=None, platform=None, session_ext_id=None, log=True):
    """세션 시작 때 에이전트에 넣는 블록. 예산 안에서 위에서부터 채운다."""
    t0 = time.time()
    pol = db.policy("injection")
    budget = pol["token_budget"]
    uid = user["id"]
    pid = access.personal_space_id(uid)
    teams = [s for s in access.user_spaces(uid) if s["kind"] == "team"]
    team_ids = [s["id"] for s in teams]
    sections, memo_ids, topic_ids = [], [], []

    def scope_clause():
        return "(m.scope='global' OR m.project_key=?)" if project_key else "m.scope='global'"

    def args(*a):
        return (*a, project_key) if project_key else a

    # 1. 지시·선호: 항상 주입. 우선순위(저장소 범위, 최근 순)대로 두 상한 안에 들어가는 것만 넣는다.
    #    - 개수 상한 max_instructions: 0이면 지시를 넣지 않는다(예전 SQL LIMIT 0과 같은 뜻).
    #    - 글자 상한 instruction_chars: 0이면 글자 상한이 없다. 첫 지시에도 적용한다.
    #    상한에 들어가지 않는 지시는 건너뛰고 다음 것을 계속 본다. 넘는 순간 멈추면, 긴 지시 하나가
    #    나머지 지시를 모두 밀어낸다.
    usage = instruction_usage(uid, project_key)
    inst, chars = [], 0
    for r in usage["items"]:
        if len(inst) >= usage["max_count"]:
            break
        if usage["limit"] and chars + r["chars"] > usage["limit"]:
            continue
        inst.append(r)
        chars += r["chars"]
    over = len(usage["items"]) - len(inst)
    if inst or over:   # 지시가 모두 빠졌어도 구역은 남겨, 화면이 빠진 이유를 보여 줄 수 있게 한다
        sections.append({"key": "instructions", "title": "지시·선호 (항상 적용)", "tier": "mine", "over_limit": over,
                         "items": [{"memo_id": r["id"], "text": r["body"], "tag": "이 저장소" if r["scope"] == "project" else None} for r in inst]})
    if team_ids:
        tinst = db.q(f"SELECT m.id, m.body, u.name AS author FROM memos m JOIN users u ON u.id=m.author_id "
                     f"WHERE m.space_id IN ({','.join('?' * len(team_ids))}) AND m.kind='instruction' AND m.status='active' AND {scope_clause()} "
                     f"ORDER BY m.created_at DESC LIMIT 6", *args(*team_ids))
        if tinst:
            sections.append({"key": "team_instructions", "title": "팀 규칙", "tier": "team",
                             "items": [{"memo_id": r["id"], "text": r["body"], "tag": r["author"]} for r in tinst]})
    # 2. 진행 상태
    st = latest_state(uid, project_key) if project_key else None
    if st:
        sections.append({"key": "state", "title": "지난 세션에서 이어받은 진행 상태", "tier": "state",
                         "items": [{"memo_id": st["id"], "text": st["body"], "tag": st.get("platform")}]})
    # 3. 절차 색인(#16): '언제 쓰는지 → 절차 제목'만 넣는다. 에이전트가 그 작업을 하게 되면 get_topic으로 꺼내 따른다.
    #    지식 색인보다 앞에 둔다. 예산이 모자라면 지식 색인이 먼저 잘린다. 절차는 모르고 지나치면 같은 실수를 되풀이한다.
    # 4. 지식 색인: 본문은 넣지 않고 제목만. 상세는 recall로 꺼낸다.
    def topic_rows(space_filter, sargs, lim, kind="knowledge"):
        cond = "(t.project_key IS NULL OR t.project_key=?)" if project_key else "t.project_key IS NULL"
        # 사람이 확인하지 않은 세션 추출 후보만 있는 주제는 색인에 넣지 않는다.
        # 순서: 이 저장소의 주제 → 최근 30일 동안 에이전트가 꺼내 쓴 횟수 → 최근 변경.
        # 예산을 넘으면 뒤에서부터 잘리므로, 자주 쓰이는 지식이 남는다.
        since = db.now() - 30 * 86400
        return db.q(f"SELECT t.id, t.title, t.project_key, COUNT(DISTINCT mt.memo_id) AS n, MAX(m.created_at) AS last, "
                    f"(SELECT COUNT(*) FROM memo_uses u JOIN memo_topics ut ON ut.memo_id=u.memo_id "
                    f" WHERE ut.topic_id=t.id AND u.kind IN ('recall','used') AND u.created_at>=?) AS uses "
                    f"FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id JOIN memos m ON m.id=mt.memo_id AND m.status='active' AND m.trust!='low' "
                    f"WHERE {space_filter} AND {cond} AND t.kind=? GROUP BY t.id "
                    f"ORDER BY (t.project_key IS NOT NULL) DESC, uses DESC, last DESC LIMIT ?",
                    since, *sargs, *((project_key,) if project_key else ()), kind, lim)

    def proc_items(rows):
        return [{"topic_id": t["id"], "text": f"{w} → {t['title']}" if (w := _when_line(t["id"])) else t["title"]} for t in rows]
    max_proc = int(pol.get("max_procedures", 20) or 0)
    if max_proc:
        mp = topic_rows("t.space_id=?", (pid,), max_proc, "procedure")
        if mp:
            sections.append({"key": "procedures", "title": "내 절차 색인", "tier": "mine", "items": proc_items(mp)})
        if team_ids:
            tp = topic_rows(f"t.space_id IN ({','.join('?' * len(team_ids))})", tuple(team_ids), max(3, max_proc // 2), "procedure")
            if tp:
                sections.append({"key": "team_procedures", "title": "팀 절차 색인", "tier": "team", "items": proc_items(tp)})
    mine = topic_rows("t.space_id=?", (pid,), pol["max_topics"])
    if mine:
        sections.append({"key": "topics", "title": "내 지식 색인", "tier": "mine",
                         "items": [{"topic_id": t["id"], "text": _topic_line(t), "tag": f"메모 {t['n']}건"} for t in mine]})
    if team_ids:
        tt = topic_rows(f"t.space_id IN ({','.join('?' * len(team_ids))})", tuple(team_ids), max(3, pol["max_topics"] // 2))
        if tt:
            sections.append({"key": "team_topics", "title": "팀 지식 색인", "tier": "team",
                             "items": [{"topic_id": t["id"], "text": _topic_line(t), "tag": f"메모 {t['n']}건"} for t in tt]})

    head = "# Conntext\n이 사용자가 쌓아 둔 맥락이다. 지식 색인에는 주제 제목만 실었다. 지금 작업과 관련 있어 보이는 주제가 있으면 conntext의 `recall` 도구로 찾거나 `get_topic`에 [t:번호]를 넣어 본문을 꺼내 쓴다.\n"
    # 절차 안내는 절차 색인이 실제로 들어갈 때만 붙인다. 자리는 미리 잡아 두고, 다 잘리면 돌려받는다.
    proc_note = "절차 색인의 '언제'에 해당하는 작업을 하게 되면, 시작하기 전에 `get_topic`으로 그 절차를 꺼내 순서와 주의점을 따른다.\n" \
        if any(s["key"] in ("procedures", "team_procedures") for s in sections) else ""
    foot = "\n메모를 답에 썼으면 `mark_used`로 알린다. 사용자가 틀렸다고 하면 `remember`로 고친 내용을 저장한다.\n"
    used = est_tokens(head) + est_tokens(foot) + (est_tokens(proc_note) if proc_note else 0)
    kept = []
    for sec in sections:
        title_cost = est_tokens(sec["title"]) + 4
        items, cost = [], title_cost
        for it in sec["items"]:
            line = _line(it)
            c = est_tokens(line) + 2
            if used + cost + c > budget:
                break
            items.append({**it, "tokens": c})
            cost += c
        dropped = len(sec["items"]) - len(items)
        if items:
            used += cost
            kept.append({**sec, "items": items, "tokens": cost, "dropped": dropped})
        elif sec["items"] or sec.get("over_limit"):
            kept.append({**sec, "items": [], "tokens": 0, "dropped": dropped})
    if proc_note and not any(sec["items"] for sec in kept if sec["key"] in ("procedures", "team_procedures")):
        used -= est_tokens(proc_note)
        proc_note = ""
    head += proc_note
    # 지시가 상한 때문에 빠졌다는 안내는 내용을 채운 뒤 남은 예산 안에서만 붙인다(리뷰 PR #21).
    # 긴 안내가 안 들어가면 짧은 안내, 그것도 안 들어가면 생략한다. 예산이 내용보다 안내에 쓰이지 않게 한다.
    notice = ""
    if over:
        limit = f"{usage['limit']:,}자" if usage["limit"] else "없음"
        for cand in (f"항상 적용 지시·선호 {over}건이 상한(최대 {usage['max_count']}건, 글자 {limit})에 들어가지 않아 빠졌다. "
                     "적당한 때에 사용자에게 비슷한 지시를 합치거나 긴 지시를 줄이자고 제안한다(웹의 '에이전트' 화면이나 remember의 replaces로 정리).\n",
                     f"지시·선호 {over}건이 상한 때문에 빠졌다. 사용자에게 정리를 제안한다.\n"):
            if used + est_tokens(cand) <= budget:
                notice = cand
                used += est_tokens(cand)
                break
    text = head + notice
    for sec in kept:
        if not sec["items"]:
            continue
        text += f"\n## {sec['title']}\n" + "\n".join(_line(it) for it in sec["items"]) + "\n"
        for it in sec["items"]:
            if it.get("memo_id"):
                memo_ids.append(it["memo_id"])
            if it.get("topic_id"):
                topic_ids.append(it["topic_id"])
    text += foot
    # 넣을 것이 없어도 지시가 상한 때문에 빠졌다면, 예산이 허락하는 한 그 사실은 알린다(머리말만 들어간다).
    empty = not any(s["items"] for s in kept) and not notice
    ms = (time.time() - t0) * 1000
    if log:
        now = db.now()
        db.insert("injections", user_id=uid, platform=platform, session_ext_id=session_ext_id, project_key=project_key,
                  memo_ids=memo_ids, topic_ids=topic_ids, tokens=used, ms=ms, created_at=now)
        for mid in memo_ids:
            db.insert("memo_uses", memo_id=mid, user_id=uid, kind="inject", session_ext_id=session_ext_id, created_at=now)
        db.metric("latency", "inject", ms, user_id=uid)
    usage_out = {"chars": usage["chars"], "limit": usage["limit"], "count": len(usage["items"]), "injected": len(inst), "over": over}
    return {"text": "" if empty else text, "tokens": 0 if empty else used, "budget": budget, "sections": kept, "instruction_usage": usage_out,
            "memo_ids": memo_ids, "topic_ids": topic_ids, "ms": round(ms, 1), "project_key": project_key}


def _when_line(topic_id, n=3):
    """절차 문서의 '언제 쓰는지': 확인된 절차 메모들의 when을 최근 것부터 최대 n개 잇는다."""
    rows = db.q("SELECT m.when_hint FROM memos m JOIN memo_topics mt ON mt.memo_id=m.id WHERE mt.topic_id=? AND m.status='active' "
                "AND m.trust!='low' AND m.kind='procedure' AND m.when_hint IS NOT NULL AND m.when_hint!='' ORDER BY m.created_at DESC", topic_id)
    return " / ".join(list(dict.fromkeys(r["when_hint"] for r in rows))[:n])


def _topic_line(t):
    """색인 줄은 주제 제목만 쓴다. 본문은 에이전트가 관련 있을 때 recall·get_topic으로 꺼낸다.
    본문 발췌를 붙이면 메모가 짧을 때 거의 본문 전체가 되어, 색인이 본문만큼 예산을 쓴다."""
    return t["title"]


def _line(it):
    ref = f"[m:{it['memo_id']}]" if it.get("memo_id") else f"[t:{it['topic_id']}]"
    tag = f" ({it['tag']})" if it.get("tag") else ""
    text = it["text"].strip().replace("\n", "\n  ")
    return f"- {text}{tag} {ref}"
