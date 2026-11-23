"""메모 ingest 파이프라인.

원문 메모는 수정하지 않고 보존한다. 분류, 관계 판정, 주제 문서는 그 위에 얹는 파생 정보이고
모두 되돌릴 수 있다. 흐름은 다음과 같다.

  마스킹 → 저장·임베딩(즉시 검색 가능) → 분석(종류·개체·관계·주제) → 적용 → 주제 문서 재생성 예약
"""
import re, time
from . import access, config, db, embed, jobs, llm, masking, retrieval
from .access import BadRequest, Forbidden, NotFound

CHANGE_WORDS = re.compile(r"변경|바뀌|바뀜|이제|더 ?이상|대신|수정|정정|→|->|아니라|취소|연기|앞당")
INSTRUCTION_WORDS = re.compile(r"항상|언제나|절대|하지 ?마|말 ?것|줘(?![가-힣])|주세요|할 것(?![가-힣])|쓰지 ?마|우선해|\balways\b|\bnever\b", re.I)
# 절차(#16): 번호 매긴 단계가 둘 이상이거나, '먼저 … 그다음', '…하려면 … 실행' 같은 순서·방법 표현.
PROCEDURE_STEPS = re.compile(r"(?m)^\s*(?:\d+[.)]|[①-⑨])\s*\S.*\n(?:.*\n)*?\s*(?:\d+[.)]|[①-⑨])\s*\S")
PROCEDURE_WORDS = re.compile(r"먼저\s.{2,80}?(?:그\s?다음|다음에|한\s?(?:뒤|후|다음)|하고\s?나서|이후에)"
                             r"|(?:하려면|할\s?때는|할\s?때에는)\s.{0,120}?(?:`[^`]+`|실행|명령|돌린|돌려|띄우|띄운|순서)"
                             r"|(?:절차|순서|방법)\s?[:：은는]")
STATE_WORDS = re.compile(r"대기 ?중|진행 ?중|작업 ?중|회신 ?대기|까지 ?완료|남은 ?일|다음에 ?할|하던 ?중|보류|WIP|in progress", re.I)
TITLES = "과장|팀장|책임|수석|선임|대리|부장|차장|사원|매니저|프로|님|리드|파트장|실장|상무|이사"
PERSON = re.compile(rf"([가-힣]{{1,4}})\s?({TITLES})(?![가-힣])")
ASCII_TERM = re.compile(r"`([^`]{2,40})`|\b([A-Z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*|[a-z]+(?:[-_][a-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]*)\b")
STOP_TERMS = {"TODO", "WIP", "OK", "QA", "PR", "API", "ID", "URL", "I", "A", "The", "It", "This"}


# ── 규칙 경로 ───────────────────────────────────────────────────────
def heuristic_entities(text):
    out, seen = [], set()
    for m in PERSON.finditer(text):
        name = f"{m.group(1)} {m.group(2)}"
        if name not in seen:
            seen.add(name)
            out.append({"name": name, "kind": "person"})
    for m in ASCII_TERM.finditer(text):
        name = (m.group(1) or m.group(2)).strip()
        if name in STOP_TERMS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "kind": "system" if re.search(r"[-_.]|[a-z][A-Z]", name) else "term"})
    return out[:8]


def heuristic_kind(text):
    if STATE_WORDS.search(text):
        return "state"
    if PROCEDURE_STEPS.search(text) or PROCEDURE_WORDS.search(text):
        return "procedure"
    if INSTRUCTION_WORDS.search(text) and len(text) < 160:
        return "instruction"
    return "knowledge"


TITLE_MAX = 40
CLAUSE_END = re.compile(r"[,;:)\]]|[,;:]?\s[-–—]\s")   # 이 뒤에서 끊으면 앞부분이 한 덩어리로 읽힌다


def _title(text):
    """규칙 기반 제목: 첫 문장을 의미 경계에서 끊는다. 단어 중간에서는 자르지 않는다.

    1. 첫 줄의 첫 문장만 쓴다. 끝의 마침표는 뗀다.
    2. TITLE_MAX 안이면 그대로 쓴다.
    3. 넘으면 한도 안의 마지막 절 경계(쉼표, 쌍점, 괄호 닫힘, 줄표) 뒤에서 끊는다. 앞부분이 너무 짧으면 쓰지 않는다.
    4. 그것도 없으면 한도 안의 마지막 공백에서 끊고 "…"를 붙인다.
    5. 공백이 없는 긴 덩어리(주소 등)만 한도에서 자르고 "…"를 붙인다.
    """
    first = next((ln for ln in text.strip().splitlines() if ln.strip()), "")
    t = re.sub(r"\s+", " ", first.replace("`", "")).strip()
    t = re.split(r"(?<=[.!?。])\s", t)[0]
    t = re.sub(r"[.。!?…]+$", "", t).strip()
    if len(t) <= TITLE_MAX:
        return t
    head = t[:TITLE_MAX + 1]
    cuts = []
    for m in CLAUSE_END.finditer(head):
        i, g = m.start(), m.group(0)
        if i > TITLE_MAX:
            continue
        if g in ")]":
            # 괄호 바로 뒤에 조사가 붙으면("간격(…)은") 구절이 이어지는 중이라 경계가 아니다.
            nxt = t[i + 1:i + 2]
            if nxt and not nxt.isspace() and nxt not in ",;:.":
                continue
            i += 1
        cuts.append(i)
    cuts = [c for c in cuts if c >= TITLE_MAX * 0.45]
    if cuts:
        return t[:cuts[-1]].rstrip(" ,;:-–—")
    sp = head.rfind(" ")
    if sp >= TITLE_MAX * 0.3:
        return t[:sp].rstrip(" ,;:") + "…"
    return t[:TITLE_MAX] + "…"


def _legacy_title(text):
    """p2까지 쓰던 규칙 기반 제목. 재처리 때 규칙이 만든 제목인지 알아보는 데만 쓴다."""
    t = re.sub(r"\s+", " ", text).strip()
    t = re.split(r"(?<=[.!?。])\s|\n", t)[0]
    return t[:30] + ("…" if len(t) > 30 else "")


def retitle(memo):
    """옛 규칙이 만든 제목이면 새 규칙으로 바꾼다. LLM이나 사람이 정한 제목은 건드리지 않는다."""
    if not memo["body"] or memo["title"] != _legacy_title(memo["body"]):
        return False
    new = _title(memo["body"])
    if new == memo["title"]:
        return False
    db.ex("UPDATE memos SET title=? WHERE id=?", new[:60], memo["id"])
    db.ex("UPDATE memos_fts SET title=? WHERE rowid=?", new[:60], memo["id"])
    return True


WHEN_MAX = 40
WHEN_MARK = re.compile(r"^(.{2,30}?)\s?(?:하려면|할\s?때는|할\s?때에는|할\s?때|시에는)(?=[\s,]|$)")
PROC_SUFFIX = re.compile(r"\s*(?:절차|순서|방법)$")


LIST_ITEM = re.compile(r"^\s*(?:\d+[.)]|[①-⑨]|[-*•])\s*")


def _clean_line(ln):
    return re.sub(r"[`*_]", "", re.sub(r"\s+", " ", LIST_ITEM.sub("", ln))).strip()


def procedure_lead(text):
    """절차가 무슨 작업인지 드러내는 부분. 단계 목록이 아닌 첫 줄(머리말)을 쓰고,
    단계만 있으면 마지막 단계를 쓴다. 단계는 대개 목표(배포, 반영)로 끝나기 때문이다.
    돌려주는 값: (문구, 마지막 단계에서 왔는지)"""
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    head = next((ln for ln in lines if not LIST_ITEM.match(ln)), None)
    if head:
        return _clean_line(head).rstrip(":：").strip(), False   # "스테이징 배포 절차:" 같은 머리말의 끝 쌍점
    return _clean_line(lines[-1]) if lines else "", True


def heuristic_when(text):
    """절차를 언제 꺼내 쓰는지 한 줄. '배포하려면 …' → '배포할 때', '스테이징 배포 절차: …' → '스테이징 배포할 때',
    단계만 있으면 '1. make build 2. make deploy' → '‘make deploy’로 끝나는 작업을 할 때'(리뷰 PR #22)."""
    lead, from_steps = procedure_lead(text)
    if from_steps:
        return f"‘{lead[:24]}’로 끝나는 작업을 할 때"
    m = WHEN_MARK.match(lead)
    if m:
        ph = m.group(1).strip()
        return (f"{ph} 할 때" if re.search(r"[을를]$", ph) else f"{ph}할 때")[:WHEN_MAX]
    ph = topic_phrase(lead)
    core = PROC_SUFFIX.sub("", ph).strip()
    if core and core != ph:
        return f"{core}할 때"[:WHEN_MAX]
    return f"{ph} 작업을 할 때"[:WHEN_MAX]


def clean_when(v):
    v = re.sub(r"\s+", " ", v or "").strip().rstrip(".")
    return v[:60] or None


TOPIC_MARK = re.compile(r"^(.{2,28}?)(?:\([^)]{0,40}\))?(?:은|는|:)(?=\s)")


def topic_phrase(text):
    """한국어의 주제 조사(은/는)나 콜론 앞부분을 주제 문구로 쓴다. 없으면 앞의 두세 단어."""
    t = re.sub(r"[`*_]", "", re.sub(r"\s+", " ", text)).strip()
    m = TOPIC_MARK.match(t)
    if m:
        ph = m.group(1).strip()
        if ph not in ("원인", "결정", "주의", "참고", "결론", "이유") and len(ph) >= 2:
            return re.sub(r"(에서|에는|에서는|의 경우)$", "", ph).strip() or ph
        t = t[m.end():].strip()
        m2 = TOPIC_MARK.match(t)
        if m2:
            return m2.group(1).strip()
    words = t.split(" ")
    return " ".join(words[:3])[:28]


# 주제 문서를 갖는 종류와 그 문서의 종류. 지식 문서와 절차 문서는 섞지 않는다(#16).
TOPIC_KIND = {"knowledge": "knowledge", "procedure": "procedure"}


def heuristic_analyze(text, candidates, topics, space_id, kind=None):
    kind = kind or heuristic_kind(text)
    ents = heuristic_entities(text)
    res = {"kind": kind, "title": _title(text), "when": heuristic_when(text) if kind == "procedure" else "", "entities": ents,
           "relation": "none", "target_id": None, "related_ids": [], "topic_id": None, "topic_title": None}
    if kind in TOPIC_KIND:
        topics = [t for t in topics if t.get("kind", "knowledge") == TOPIC_KIND[kind]]
    # 중복·갱신·보충은 같은 종류끼리만 판정한다. 절차와 지식은 비슷해도 합치지 않고 관련으로만 잇는다(리뷰 PR #22).
    same_kind = [c for c in candidates if c["kind"] == kind or (kind == "knowledge" and c["kind"] != "procedure")]
    cross = [c for c in candidates if c not in same_kind and kind in TOPIC_KIND and c["kind"] in TOPIC_KIND and c["cos"] >= 0.16]
    if same_kind:
        top = same_kind[0]
        cos = top["cos"]
        if cos >= 0.72:
            res.update(relation="duplicate", target_id=top["id"])
        elif cos >= 0.33 and CHANGE_WORDS.search(text):
            res.update(relation="update", target_id=top["id"])
        elif cos >= 0.30:
            res.update(relation="supplement", target_id=top["id"])
        elif cos >= 0.16:
            res.update(relation="related", related_ids=[top["id"]])
        res["related_ids"] = [c["id"] for c in same_kind[1:4] if c["cos"] >= 0.2 and c["id"] != res["target_id"]]
    res["related_ids"] += [c["id"] for c in cross[:2]]
    if kind in TOPIC_KIND and res["relation"] in ("none", "related"):
        # 주제 문구가 기존 주제 제목과 충분히 가까우면 거기에 붙이고, 아니면 새 주제를 만든다.
        # 개체가 겹친다는 이유만으로는 합치지 않는다(BLE, OTA 같은 넓은 개체가 모든 메모를 한 문서로 끌어모은다).
        phrase = topic_phrase(procedure_lead(text)[0] if kind == "procedure" else text)
        if kind == "procedure" and not PROC_SUFFIX.search(phrase):
            phrase = f"{phrase} 절차"
        pv, best, best_s = embed.embed(phrase), None, 0.0
        for t in topics:
            sc = embed.cosine(pv, embed.embed(t["title"]))
            if sc > best_s:
                best, best_s = t, sc
        if best and best_s >= 0.6:
            res["topic_id"] = best["id"]
        else:
            res["topic_title"] = phrase
    return res


def heuristic_topic_summary(memos, procedure=False):
    active = [m for m in memos if m["status"] == "active"]
    old = [m for m in memos if m["status"] == "superseded"]
    lines = []
    for m in active:
        mark = " (미확인)" if m["trust"] == "low" else ""
        if procedure:
            # 절차 본문은 여러 줄 단계라 목록 한 칸에 넣으면 깨진다. 절차마다 소제목을 단다.
            lines.append(f"## {m.get('when_hint') or m['title']}{mark}\n{m['body'].strip()} [m:{m['id']}]\n")
            continue
        lines.append(f"- {m['body'].strip()}{mark} [m:{m['id']}]")
    if old and procedure:
        # 에이전트가 이 문서를 그대로 따르므로, 대체된 판의 단계와 명령은 싣지 않는다(리뷰 PR #22).
        lines.append("대체된 이전 판: " + ", ".join(f"[m:{m['id']}]" for m in old) + " (옛 단계라 여기 싣지 않음)")
    elif old:
        lines.append("\n## 이전 기록")
        for m in old:
            lines.append(f"- 이전에는: {m['body'].strip()} [m:{m['id']}]")
    return "\n".join(lines)


# ── 분석 ────────────────────────────────────────────────────────────
LLM_CANDIDATES = 8


def llm_candidates(found, memo, space_id):
    """LLM에 넘길 후보: 검색 상위 후보(유사도 컷 없음)에 같은 저장소의 최근 메모를 더한다. 중복 없이 최대 8건."""
    out, seen = [], {memo["id"]}
    for c in found:
        if c["id"] not in seen:
            seen.add(c["id"])
            out.append(c)
    if memo.get("project_key") and len(out) < LLM_CANDIDATES:
        for r in db.q("SELECT id, body, kind, created_at FROM memos WHERE space_id=? AND project_key=? AND status='active' "
                      "AND kind IN ('knowledge','procedure','instruction') AND id!=? ORDER BY created_at DESC, id DESC LIMIT ?",
                      space_id, memo["project_key"], memo["id"], LLM_CANDIDATES):
            if r["id"] not in seen and len(out) < LLM_CANDIDATES:
                seen.add(r["id"])
                out.append(dict(r))
    return out[:LLM_CANDIDATES]


def analyze(user_id, memo, space_id, forced_kind=None):
    found = retrieval.search([space_id], memo["body"], memo.get("project_key"), limit=5, exclude_ids=(memo["id"],),
                             min_score=0.0, statuses=("active",), kinds=("knowledge", "procedure", "instruction"))
    topics = db.q("SELECT id, title, kind FROM topics WHERE space_id=? ORDER BY updated_at DESC LIMIT 40", space_id)
    out = None
    if llm.provider() != "heuristic":
        # 유사도 컷(0.1)은 규칙 경로용이다. 표현이 다른 관련 메모를 놓치므로 LLM에는 컷 없이 넓게 넘긴다.
        cands = llm_candidates(found, memo, space_id)
        lines = [f"새 메모:\n{memo['body']}\n"]
        if memo.get("project_key"):
            lines.append(f"작성 위치(저장소): {memo['project_key']}\n")
        lines.append("후보 메모:" if cands else "후보 메모: 없음")
        for c in cands:
            lines.append(f"- id {c['id']} ({time.strftime('%Y-%m-%d', time.localtime(c['created_at']))}, {c['kind']}): {c['body'][:400]}")
        lines.append("\n기존 주제:" if topics else "\n기존 주제: 없음")
        for t in topics:
            lines.append(f"- id {t['id']}: {t['title']}" + (" (절차)" if t["kind"] == "procedure" else ""))
        out = llm.complete_json("analyze", llm.ANALYZE_SYSTEM, "\n".join(lines), llm.ANALYZE_SCHEMA, user_id)
        if out:
            cand_ids = {c["id"] for c in cands}
            topic_ids = {t["id"] for t in topics}
            if out.get("target_id") not in cand_ids:
                out["target_id"] = None
                if out.get("relation") in ("duplicate", "update", "supplement"):
                    out["relation"] = "none"
            out["related_ids"] = [i for i in out.get("related_ids") or [] if i in cand_ids and i != out.get("target_id")]
            if out.get("topic_id") not in topic_ids:
                out["topic_id"] = None
            # 주제 목록의 '(절차)' 표시를 새 제목에 따라 붙이는 경우가 있다.
            if out.get("topic_title"):
                out["topic_title"] = re.sub(r"\s*\(절차\)\s*$", "", out["topic_title"]).strip() or None
            out["_by"] = "llm"
    if out is None:
        cands = [c for c in found if c["cos"] >= 0.1]
        out = heuristic_analyze(memo["body"], cands, topics, space_id, kind=forced_kind)
        out["_by"] = "rule"
    if forced_kind:
        out["kind"] = forced_kind
    # 고른 주제가 다른 종류의 문서면(절차 메모 → 지식 문서) 쓰지 않고 새 제목으로 만든다.
    tkind = TOPIC_KIND.get(out["kind"])
    if out.get("topic_id") and tkind and next((t["kind"] for t in topics if t["id"] == out["topic_id"]), None) != tkind:
        out["topic_id"] = None
    out["when"] = clean_when(out.get("when")) if out["kind"] == "procedure" else None
    if out["kind"] == "procedure" and not out["when"]:
        out["when"] = heuristic_when(memo["body"])
    return out


def _ensure_topic(space_id, title, project_key=None, origin_topic_id=None, kind="knowledge"):
    title = re.sub(r"\s+", " ", title).strip()[:60] or "제목 없음"
    row = db.one("SELECT id FROM topics WHERE space_id=? AND lower(title)=lower(?) AND kind=?", space_id, title, kind)
    if row:
        return row["id"], False
    now = db.now()
    tid = db.insert("topics", space_id=space_id, title=title, project_key=project_key, origin_topic_id=origin_topic_id,
                    kind=kind, dirty=1, created_at=now, updated_at=now)
    return tid, True


def _attach(memo_id, topic_id):
    db.ex("INSERT OR IGNORE INTO memo_topics(memo_id, topic_id) VALUES(?,?)", memo_id, topic_id)
    mark_dirty(topic_id)


def mark_dirty(topic_id):
    db.ex("UPDATE topics SET dirty=1, updated_at=? WHERE id=?", db.now(), topic_id)
    jobs.enqueue("topic_summary", {"topic_id": topic_id}, dedupe=True)


def _link(a, b, relation):
    if a == b:
        return
    db.ex("INSERT OR REPLACE INTO links(a_memo, b_memo, relation, created_at) VALUES(?,?,?,?)", a, b, relation, db.now())


def _set_entities(memo_id, space_id, ents):
    for e in ents or []:
        name = (e.get("name") or "").strip()[:60]
        if not name:
            continue
        row = db.one("SELECT id FROM entities WHERE space_id=? AND name=?", space_id, name)
        eid = row["id"] if row else db.insert("entities", space_id=space_id, name=name, kind=e.get("kind") or "term")
        db.ex("INSERT OR IGNORE INTO memo_entities(memo_id, entity_id) VALUES(?,?)", memo_id, eid)


def _topics_of(memo_id, kind=None):
    if kind:
        return [r["id"] for r in db.q("SELECT t.id FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=? AND t.kind=?", memo_id, kind)]
    return [r["topic_id"] for r in db.q("SELECT topic_id FROM memo_topics WHERE memo_id=?", memo_id)]


# ── 저장 ────────────────────────────────────────────────────────────
def remember(user, text, *, space_id=None, scope=None, project_key=None, kind=None, source="manual", trust="high",
             origin_session_id=None, origin_memo_id=None, source_acl=None, expires_at=None, replaces_id=None,
             topic_hint=None, origin_topic_id=None, do_analyze=True, when=None):
    text = (text or "").strip()
    if not text:
        raise BadRequest("저장할 내용이 비어 있습니다.")
    if len(text) > 20000:
        raise BadRequest("메모가 너무 깁니다(최대 20,000자). 나눠서 저장하세요.")
    t0 = time.time()
    uid = user["id"]
    space_id = space_id or access.personal_space_id(uid)
    body, masked = masking.mask(text)
    if not body.strip():
        raise BadRequest("비공개 처리 후 남은 내용이 없습니다.")
    if scope is None:
        scope = "project" if project_key else "global"
    if scope == "global" and kind != "state":
        pk = None
    else:
        pk = project_key
    now = db.now()
    mid = db.insert("memos", space_id=space_id, author_id=uid, body=body, title=_title(body), kind=kind or "knowledge",
                    source=source, trust=trust, scope=scope, project_key=pk, status="active",
                    origin_session_id=origin_session_id, origin_memo_id=origin_memo_id,
                    source_acl=source_acl or None, masked_count=masked, embedding=embed.pack(embed.embed(body)),
                    pipeline_version=config.PIPELINE_VERSION, created_at=now, updated_at=now, expires_at=expires_at)
    db.ex("INSERT INTO memos_fts(rowid, body, title) VALUES(?,?,?)", mid, body, _title(body))
    db.trace("store", f"masked={masked}", memo_id=mid, ms=(time.time() - t0) * 1000)
    memo = db.one("SELECT * FROM memos WHERE id=?", mid)
    detail = {"relation": "none", "target_id": None, "topic_ids": [], "created_topic_ids": [], "masked": masked}

    if kind == "state" or not do_analyze:
        a = {"kind": kind or "knowledge", "title": _title(body), "when": None, "entities": heuristic_entities(body), "relation": "none",
             "target_id": None, "related_ids": [], "topic_id": None, "topic_title": topic_hint, "_by": "skip"}
    else:
        t1 = time.time()
        a = analyze(uid, memo, space_id, forced_kind=kind)
        db.trace("analyze", f"{a['_by']}:{a['kind']}:{a['relation']}", memo_id=mid, ms=(time.time() - t1) * 1000)
    if replaces_id:
        a.update(relation="update", target_id=replaces_id)
    new_kind = a["kind"]
    db.ex("UPDATE memos SET kind=?, title=? WHERE id=?", new_kind, (a.get("title") or _title(body))[:60], mid)
    db.ex("UPDATE memos_fts SET title=? WHERE rowid=?", (a.get("title") or "")[:60], mid)
    if new_kind == "state" and not expires_at:
        days = db.policy("retention").get("state_days", 14)
        db.ex("UPDATE memos SET expires_at=?, trust=CASE WHEN trust='high' THEN 'temp' ELSE trust END WHERE id=?", now + days * 86400, mid)
    _set_entities(mid, space_id, a.get("entities"))

    rel, target_id = a["relation"], a.get("target_id")
    target = db.one("SELECT * FROM memos WHERE id=? AND space_id=?", target_id, space_id) if target_id else None
    if rel in ("duplicate", "update", "supplement") and not target:
        rel = "none"
    # 절차와 지식은 서로 합치거나 이어 붙이지 않는다. 합치면 한쪽이 비활성이 되어 그 종류의 색인에서 사라진다.
    # 갱신은 같은 사안이 바뀐 것이라 대체하되, 종류는 새 내용대로 둔다.
    cross = bool(target) and new_kind in TOPIC_KIND and target["kind"] in TOPIC_KIND and target["kind"] != new_kind
    if cross and rel in ("duplicate", "supplement"):
        a["related_ids"] = [target["id"], *(a.get("related_ids") or [])]
        rel, target = "none", None
    # 확인되지 않은 세션 추출 후보가 사람이 적은 메모를 대체하지는 못한다.
    if rel == "update" and trust == "low" and target["trust"] != "low":
        rel = "supplement"
    detail["relation"], detail["target_id"] = rel, target["id"] if target and rel != "none" else None

    topic_ids = []
    if rel == "duplicate":
        db.ex("UPDATE memos SET status='duplicate', superseded_by=? WHERE id=?", target["id"], mid)
        db.ex("UPDATE memos SET updated_at=? WHERE id=?", now, target["id"])
        _link(mid, target["id"], "duplicate")
        topic_ids = _topics_of(target["id"])
    elif rel == "update":
        detail["prev_target_status"] = target["status"]
        db.ex("UPDATE memos SET status='superseded', superseded_by=?, updated_at=? WHERE id=?", mid, now, target["id"])
        _link(mid, target["id"], "supersedes")
        if target["kind"] != new_kind and not kind and not cross:
            db.ex("UPDATE memos SET kind=? WHERE id=?", target["kind"], mid)
            new_kind = target["kind"]
        # 같은 종류의 문서만 물려받는다. 지식 메모를 절차로 고쳐 쓰면 절차 문서에 새로 붙는다.
        if new_kind in TOPIC_KIND:
            for tid in _topics_of(target["id"], TOPIC_KIND[new_kind]):
                _attach(mid, tid)
                topic_ids.append(tid)
    elif rel == "supplement":
        _link(mid, target["id"], "supplements")
        if new_kind in TOPIC_KIND:
            for tid in _topics_of(target["id"], TOPIC_KIND[new_kind]):
                _attach(mid, tid)
                topic_ids.append(tid)
    for rid in a.get("related_ids") or []:
        _link(mid, rid, "related")

    if new_kind == "procedure":
        wh = clean_when(when) or (a.get("when") if a["kind"] == "procedure" else None) or heuristic_when(body)
        db.ex("UPDATE memos SET when_hint=? WHERE id=?", wh, mid)
    if new_kind in TOPIC_KIND and not topic_ids and rel != "duplicate":
        tkind = TOPIC_KIND[new_kind]
        tid, created = None, False
        if a.get("topic_id") and db.val("SELECT 1 FROM topics WHERE id=? AND space_id=? AND kind=?", a["topic_id"], space_id, tkind):
            tid = a["topic_id"]
        else:
            title = topic_hint or a.get("topic_title") or a.get("title") or _title(body)
            tid, created = _ensure_topic(space_id, title, pk if scope == "project" else None, origin_topic_id, tkind)
        _attach(mid, tid)
        topic_ids.append(tid)
        if created:
            detail["created_topic_ids"].append(tid)
    detail["topic_ids"] = topic_ids
    detail["kind"] = new_kind
    eid = db.insert("ingest_events", user_id=uid, space_id=space_id, memo_id=mid, action="remember", detail=detail, created_at=now)
    db.metric("latency", "ingest", (time.time() - t0) * 1000, user_id=uid)
    return describe(mid, event_id=eid, detail=detail)


# ── 판의 계보: 원본을 고치면 새 판이 이전 판을 대체한다(superseded_by). 팀 사본은 공유 당시의
#    원본 id만 기억하므로(origin_memo_id), 계보를 따라가야 사본이 낡았는지 안다.
def current_of(memo_id, limit=50):
    """대체 이력을 앞으로 따라가 지금 판을 돌려준다. 없으면 None."""
    m = db.one("SELECT id, status, superseded_by FROM memos WHERE id=?", memo_id)
    seen = set()
    while m and m["status"] in ("superseded", "duplicate") and m["superseded_by"] and m["id"] not in seen and len(seen) < limit:
        seen.add(m["id"])
        m = db.one("SELECT id, status, superseded_by FROM memos WHERE id=?", m["superseded_by"])
    return m


def lineage(memo_id, limit=50):
    """이 메모와 그 이전 판들의 id. 이 메모가 맨 앞이다."""
    ids, frontier = [memo_id], [memo_id]
    while frontier and len(ids) < limit:
        rows = db.q(f"SELECT id FROM memos WHERE superseded_by IN ({','.join('?' * len(frontier))}) AND status IN ('superseded','duplicate')", *frontier)
        frontier = [r["id"] for r in rows if r["id"] not in ids]
        ids += frontier
    return ids


def origin_state(memo):
    """팀 사본의 원본이 그 뒤에 바뀌었는지. 'changed' | 'deleted' | None.
    작성자가 원본을 고치거나 지운 사실만 알 뿐, 개인 공간의 내용은 드러내지 않는다."""
    oid = memo.get("origin_memo_id")
    if not oid or memo.get("space_kind", "team") != "team":
        return None
    head = current_of(oid)
    if not head or head["status"] == "deleted":
        return "deleted" if head else None
    if head["id"] != oid:
        return "changed"
    return None


def stale_team_copies(memo_id, space_id=None):
    """이 메모의 이전 판을 공유해 둔, 아직 갱신되지 않은 팀 사본들."""
    older = lineage(memo_id)[1:]
    if not older:
        return []
    return db.q(f"SELECT m.id, m.space_id, s.name AS team FROM memos m JOIN spaces s ON s.id=m.space_id "
                f"WHERE s.kind='team' AND m.status='active' AND m.origin_memo_id IN ({','.join('?' * len(older))}) "
                + ("AND m.space_id=? " if space_id else "") + "ORDER BY m.id",
                *older, *((space_id,) if space_id else ()))


def instruction_overflow_lines(m):
    """지시·선호를 저장하거나 종류를 바꾼 뒤, 항상 적용 지시가 글자 상한을 넘었으면 알린다(#17).
    저장은 그대로 둔다(원문 보존). 무엇을 합치거나 줄일지는 사용자가 정한다."""
    if m["kind"] != "instruction" or m["status"] != "active" or m["trust"] == "low":
        return []
    if db.val("SELECT kind FROM spaces WHERE id=?", m["space_id"]) != "personal":
        return []
    # 세션 시작 때는 '전체 범위 + 그 저장소 범위' 지시가 함께 들어간다. 저장소 범위 지시는 그 저장소만,
    # 전체 범위 지시는 모든 저장소에 들어가므로 저장소별 합 가운데 가장 큰 경우로 판단한다.
    if m["scope"] == "project":
        keys = [m["project_key"]]
    else:
        keys = [None] + [r["project_key"] for r in db.q(
            "SELECT DISTINCT project_key FROM memos WHERE space_id=? AND kind='instruction' AND status='active' AND trust='high' "
            "AND scope='project' AND project_key IS NOT NULL", m["space_id"])]
    u, worst = None, None
    for k in keys:
        cand = retrieval.instruction_usage(m["author_id"], k)
        if u is None or cand["chars"] > u["chars"]:
            u, worst = cand, k
    if not u["limit"] or u["chars"] <= u["limit"]:
        return []
    where = f" (저장소 {short_project(worst)}에서 세션을 시작할 때 기준)" if worst else ""
    lines = [f"항상 적용 지시·선호가 상한을 넘었습니다: {u['chars']:,}자 / {u['limit']:,}자{where}. 세션 시작 때 상한에 들어가지 않는 지시는 빠집니다(이 저장소 범위와 최근 것이 우선).",
             "비슷한 것을 합치거나 긴 것을 줄일 수 있습니다. 지금 지시·선호:"]
    for r in u["items"]:
        lines.append(f"  m:{r['id']} ({r['chars']}자) {_short(r['body'], 60)}")
    return lines


def describe(memo_id, event_id=None, detail=None):
    """저장 결과를 사람이 읽는 한 줄과 함께 돌려준다. 터미널과 웹이 같은 문구를 쓴다."""
    m = db.one("SELECT * FROM memos WHERE id=?", memo_id)
    detail = detail or {}
    topics = db.q("SELECT t.id, t.title FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", memo_id)
    if not topics and detail.get("topic_ids"):
        topics = db.q(f"SELECT id, title FROM topics WHERE id IN ({','.join('?' * len(detail['topic_ids']))})", *detail["topic_ids"])
    target = db.one("SELECT id, body, created_at FROM memos WHERE id=?", detail["target_id"]) if detail.get("target_id") else None
    kind_ko = KIND_KO[m["kind"]] + (f"(언제: {m['when_hint']})" if m["kind"] == "procedure" and m.get("when_hint") else "")
    scope_ko = f"저장소 {short_project(m['project_key'])}" if m["scope"] == "project" and m["project_key"] else "전체"
    where = ", ".join(f"[{t['title']}]" for t in topics) if topics else {"instruction": "항상 적용 목록", "state": "진행 상태"}.get(m["kind"], "미분류")
    lines = [f"저장됨 m:{m['id']} → {where} · {kind_ko} · 범위: {scope_ko}"]
    rel = detail.get("relation")
    if target and rel == "update":
        lines.append(f"이전 메모 1건 대체: \"{_short(target['body'])}\" ({_date(target['created_at'])})")
    elif target and rel == "duplicate":
        lines[0] = f"이미 있는 메모와 같은 내용이라 새로 만들지 않고 m:{target['id']}에 합쳤습니다 → {where}"
    elif target and rel == "supplement":
        lines.append(f"관련 메모에 이어 붙임: \"{_short(target['body'])}\"")
    if detail.get("created_topic_ids"):
        lines.append("새 주제 문서를 만들었습니다.")
    if detail.get("masked"):
        lines.append(f"민감 정보 {detail['masked']}건을 마스킹했습니다.")
    lines += instruction_overflow_lines(m)
    stale = stale_team_copies(m["id"]) if rel == "update" and m["status"] == "active" else []
    for team in dict.fromkeys(c["team"] for c in stale):
        lines.append(f"팀 ‘{team}’에 공유된 이전 판이 그대로 있습니다. 웹에서 이 메모를 열어 팀 사본을 갱신할 수 있습니다.")
    return {"memo_id": m["id"], "event_id": event_id, "kind": m["kind"], "scope": m["scope"], "project_key": m["project_key"],
            "status": m["status"], "relation": rel or "none", "target_id": target["id"] if target else None,
            "topics": topics, "masked": detail.get("masked", 0), "message": "\n".join(lines)}


KIND_KO = {"instruction": "지시·선호", "knowledge": "지식", "procedure": "절차", "state": "진행 상태"}


def short_project(pk):
    if not pk:
        return ""
    return re.sub(r"\.git$", "", pk.rstrip("/")).split("/")[-1] or pk


def _short(s, n=42):
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n] + ("…" if len(s) > n else "")


def _date(ts):
    return time.strftime("%-m/%-d", time.localtime(ts))


# ── 되돌리기·삭제·확인 ──────────────────────────────────────────────
def undo(user, event_id):
    ev = db.one("SELECT * FROM ingest_events WHERE id=?", event_id)
    if not ev or ev["user_id"] != user["id"]:
        raise NotFound("되돌릴 내역을 찾을 수 없습니다.")
    if ev["undone_at"]:
        raise BadRequest("이미 되돌린 내역입니다.")
    d = db.js(ev["detail"], {})
    now = db.now()
    mid = ev["memo_id"]
    if ev["action"] in ("remember", "promote"):
        db.ex("UPDATE memos SET status='deleted', updated_at=? WHERE id=?", now, mid)
        if d.get("relation") == "update" and d.get("target_id"):
            db.ex("UPDATE memos SET status=?, superseded_by=NULL, updated_at=? WHERE id=? AND superseded_by=?",
                  d.get("prev_target_status") or "active", now, d["target_id"], mid)
        for oid in d.get("also_superseded") or []:
            db.ex("UPDATE memos SET status='active', superseded_by=NULL, updated_at=? WHERE id=? AND superseded_by=?", now, oid, mid)
        for tid in d.get("topic_ids") or []:
            db.ex("DELETE FROM memo_topics WHERE memo_id=? AND topic_id=?", mid, tid)
            if tid in (d.get("created_topic_ids") or []) and not db.val("SELECT 1 FROM memo_topics WHERE topic_id=?", tid):
                db.ex("DELETE FROM topics WHERE id=?", tid)
            else:
                mark_dirty(tid)
        db.ex("DELETE FROM links WHERE a_memo=?", mid)
    elif ev["action"] == "forget":
        db.ex("UPDATE memos SET status=?, updated_at=? WHERE id=?", d.get("prev_status") or "active", now, mid)
        if d.get("restored_superseded"):
            db.ex("UPDATE memos SET status='superseded', superseded_by=? WHERE id=?", mid, d["restored_superseded"])
        for tid in _topics_of(mid):
            mark_dirty(tid)
    elif ev["action"] == "kind_change":
        if db.val("SELECT kind FROM memos WHERE id=?", mid) != d.get("kind"):
            raise BadRequest("그 뒤에 종류가 다시 바뀌어 이 내역은 되돌릴 수 없습니다. 최근 내역부터 되돌리세요.")
        _undo_kind_change(mid, d, now)
    elif ev["action"] == "when_change":
        if db.val("SELECT when_hint FROM memos WHERE id=?", mid) != d.get("when"):
            raise BadRequest("그 뒤에 다시 바뀌어 이 내역은 되돌릴 수 없습니다. 최근 내역부터 되돌리세요.")
        db.ex("UPDATE memos SET when_hint=?, updated_at=? WHERE id=?", d.get("prev_when"), now, mid)
        for tid in _topics_of(mid):
            mark_dirty(tid)
    elif ev["action"] in ("confirm", "auto_promoted"):
        db.ex("UPDATE memos SET trust='low', updated_at=? WHERE id=?", now, mid)
    elif ev["action"] == "dismiss":
        db.ex("UPDATE memos SET status='active', updated_at=? WHERE id=?", now, mid)
    else:
        raise BadRequest("되돌릴 수 없는 내역입니다.")
    db.ex("UPDATE ingest_events SET undone_at=? WHERE id=?", now, event_id)
    db.trace("undo", ev["action"], memo_id=mid)
    return {"ok": True, "memo_id": mid, "message": "되돌렸습니다."}


def undo_last(user):
    ev = db.one("SELECT id FROM ingest_events WHERE user_id=? AND undone_at IS NULL AND action IN ('remember','forget','promote','kind_change','when_change') "
                "ORDER BY id DESC LIMIT 1", user["id"])
    if not ev:
        raise NotFound("되돌릴 최근 내역이 없습니다.")
    return undo(user, ev["id"])


def forget(user, memo_id):
    m = access.get_memo(user, memo_id, write=True)
    if m["status"] in ("deleted",):
        raise BadRequest("이미 삭제된 메모입니다.")
    now = db.now()
    detail = {"prev_status": m["status"]}
    # 이 메모가 대체했던 이전 메모가 있으면 다시 살린다. 지운 내용 때문에 옛 내용까지 묻히면 안 된다.
    prev = db.one("SELECT id FROM memos WHERE superseded_by=? AND status='superseded'", memo_id)
    if prev:
        db.ex("UPDATE memos SET status='active', superseded_by=NULL, updated_at=? WHERE id=?", now, prev["id"])
        detail["restored_superseded"] = prev["id"]
    db.ex("UPDATE memos SET status='deleted', updated_at=? WHERE id=?", now, memo_id)
    for tid in _topics_of(memo_id):
        mark_dirty(tid)
    eid = db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=memo_id, action="forget", detail=detail, created_at=now)
    db.trace("forget", "ok", memo_id=memo_id)
    msg = f"삭제함 m:{memo_id} \"{_short(m['body'])}\""
    if prev:
        msg += f"\n이 메모가 대체했던 이전 메모 m:{prev['id']}를 다시 유효로 돌렸습니다."
    return {"ok": True, "memo_id": memo_id, "event_id": eid, "message": msg}


KINDS = ("instruction", "knowledge", "procedure", "state")


def _pick_topic(memo, kind):
    """사용자가 종류를 knowledge·procedure로 바꿨을 때 붙일 주제. LLM을 다시 부르지 않고 규칙 경로의 주제 판정을 쓴다."""
    tkind = TOPIC_KIND[kind]
    topics = db.q("SELECT id, title, kind FROM topics WHERE space_id=? AND kind=? ORDER BY updated_at DESC LIMIT 40", memo["space_id"], tkind)
    a = heuristic_analyze(memo["body"], [], topics, memo["space_id"], kind=kind)
    if a.get("topic_id"):
        return a["topic_id"], False
    pk = memo["project_key"] if memo["scope"] == "project" else None
    return _ensure_topic(memo["space_id"], a.get("topic_title") or memo["title"] or _title(memo["body"]), pk, kind=tkind)


def set_kind(user, memo_id, kind):
    """자동 분류된 종류를 사용자가 바로잡는다. 종류는 원문이 아닌 파생 정보라 새 판을 만들지 않고 제자리에서 바꾼다."""
    if kind not in KINDS:
        raise BadRequest(f"종류는 {', '.join(KINDS)} 중 하나여야 합니다.")
    m = access.get_memo(user, memo_id, write=True)
    if m["status"] != "active":
        raise BadRequest("유효한 메모만 고칠 수 있습니다.")
    if m["kind"] == kind:
        raise BadRequest("이미 그 종류입니다.")
    now = db.now()
    prev_topics = db.q("SELECT t.id, t.title, t.project_key, t.kind FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", memo_id)
    detail = {"prev_kind": m["kind"], "kind": kind, "prev_topics": prev_topics, "prev_expires_at": m["expires_at"],
              "prev_trust": m["trust"], "prev_when": m["when_hint"], "topic_ids": [], "created_topic_ids": []}
    expires, trust = m["expires_at"], m["trust"]
    if kind == "state":
        expires = now + db.policy("retention").get("state_days", 14) * 86400
        trust = "temp" if trust == "high" else trust
    elif m["kind"] == "state":
        expires = None
        trust = "high" if trust == "temp" else trust
    when = (m["when_hint"] or heuristic_when(m["body"])) if kind == "procedure" else m["when_hint"]
    db.ex("UPDATE memos SET kind=?, expires_at=?, trust=?, when_hint=?, updated_at=? WHERE id=?", kind, expires, trust, when, now, memo_id)
    # 주제 문서는 같은 종류끼리만 둔다. 다른 종류의 문서에서는 빼고, 맞는 문서가 없으면 붙인다.
    # instruction과 state는 주제 문서에 들어가지 않는다. 비게 된 주제는 다시 생성할 때 정리된다.
    tkind = TOPIC_KIND.get(kind)
    for t in prev_topics:
        if t["kind"] != tkind:
            db.ex("DELETE FROM memo_topics WHERE memo_id=? AND topic_id=?", memo_id, t["id"])
            mark_dirty(t["id"])
    if tkind and not any(t["kind"] == tkind for t in prev_topics):
        tid, created = _pick_topic(m, kind)
        _attach(memo_id, tid)
        detail["topic_ids"].append(tid)
        if created:
            detail["created_topic_ids"].append(tid)
    eid = db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=memo_id, action="kind_change",
                    detail=detail, created_at=now)
    db.trace("kind_change", f"{m['kind']}->{kind}", memo_id=memo_id)
    res = describe(memo_id, event_id=eid, detail=detail)
    where = ", ".join(f"[{t['title']}]" for t in res["topics"]) or {"instruction": "항상 적용 목록", "state": "진행 상태"}.get(kind, "미분류")
    res["message"] = f"종류를 바꿈 m:{memo_id}: {KIND_KO[m['kind']]} → {KIND_KO[kind]} · {where}"
    if kind == "procedure":
        res["message"] += f"\n언제 쓰는 절차인지: {when} (웹에서 고칠 수 있습니다)"
    if kind == "state":
        res["message"] += f"\n진행 상태는 {db.policy('retention').get('state_days', 14)}일 뒤 만료됩니다."
    over = instruction_overflow_lines(db.one("SELECT * FROM memos WHERE id=?", memo_id))
    if over:
        res["message"] += "\n" + "\n".join(over)
    return res


def _undo_kind_change(mid, d, now):
    db.ex("UPDATE memos SET kind=?, expires_at=?, trust=?, when_hint=?, updated_at=? WHERE id=?",
          d["prev_kind"], d.get("prev_expires_at"), d.get("prev_trust"), d.get("prev_when"), now, mid)
    for tid in d.get("topic_ids") or []:
        db.ex("DELETE FROM memo_topics WHERE memo_id=? AND topic_id=?", mid, tid)
        if tid in (d.get("created_topic_ids") or []) and not db.val("SELECT 1 FROM memo_topics WHERE topic_id=?", tid):
            db.ex("DELETE FROM topics WHERE id=?", tid)
        else:
            mark_dirty(tid)
    m = db.one("SELECT space_id FROM memos WHERE id=?", mid)
    for t in d.get("prev_topics") or []:
        # 주제가 비어 그 사이 정리됐으면 같은 제목으로 다시 만든다.
        tid = t["id"] if db.val("SELECT 1 FROM topics WHERE id=?", t["id"]) else \
            _ensure_topic(m["space_id"], t["title"], t.get("project_key"), kind=t.get("kind") or "knowledge")[0]
        _attach(mid, tid)


def set_when(user, memo_id, when):
    """절차를 언제 쓰는지 한 줄을 사용자가 고친다. 파생 정보라 제자리에서 바꾸고, 되돌릴 수 있다."""
    m = access.get_memo(user, memo_id, write=True)
    if m["status"] != "active":
        raise BadRequest("유효한 메모만 고칠 수 있습니다.")
    if m["kind"] != "procedure":
        raise BadRequest("'언제 쓰는지'는 절차 메모에만 있습니다.")
    new = clean_when(when)
    if not new:
        raise BadRequest("언제 쓰는 절차인지 한 줄로 적어 주세요.")
    if new == m["when_hint"]:
        raise BadRequest("바뀐 내용이 없습니다.")
    now = db.now()
    db.ex("UPDATE memos SET when_hint=?, updated_at=? WHERE id=?", new, now, memo_id)
    for tid in _topics_of(memo_id):
        mark_dirty(tid)
    eid = db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=memo_id, action="when_change",
                    detail={"prev_when": m["when_hint"], "when": new}, created_at=now)
    res = describe(memo_id, event_id=eid)
    res["message"] = f"언제 쓰는지 바꿈 m:{memo_id}: {new}"
    return res


def confirm_candidate(user, memo_id):
    m = access.get_memo(user, memo_id, write=True)
    if m["trust"] != "low":
        raise BadRequest("세션에서 추출된 후보가 아닙니다.")
    db.ex("UPDATE memos SET trust='high', updated_at=? WHERE id=?", db.now(), memo_id)
    eid = db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=memo_id, action="confirm", detail={}, created_at=db.now())
    for tid in _topics_of(memo_id):
        mark_dirty(tid)
    return {"ok": True, "event_id": eid, "message": "정식 메모로 올렸습니다."}


def dismiss_candidate(user, memo_id):
    m = access.get_memo(user, memo_id, write=True)
    if m["trust"] != "low":
        raise BadRequest("세션에서 추출된 후보가 아닙니다.")
    db.ex("UPDATE memos SET status='dismissed', updated_at=? WHERE id=?", db.now(), memo_id)
    eid = db.insert("ingest_events", user_id=user["id"], space_id=m["space_id"], memo_id=memo_id, action="dismiss", detail={}, created_at=db.now())
    for tid in _topics_of(memo_id):
        mark_dirty(tid)
    return {"ok": True, "event_id": eid, "message": "후보를 버렸습니다."}


# ── 주제 문서 ───────────────────────────────────────────────────────
def topic_memos(topic_id):
    return db.q("SELECT m.*, u.name AS author_name FROM memos m JOIN memo_topics mt ON mt.memo_id=m.id JOIN users u ON u.id=m.author_id "
                "WHERE mt.topic_id=? AND m.status IN ('active','superseded') ORDER BY m.status='active' DESC, m.created_at DESC", topic_id)


def regenerate_topic(topic_id, user_id=None):
    t = db.one("SELECT * FROM topics WHERE id=?", topic_id)
    if not t:
        return None
    memos = topic_memos(topic_id)
    if not any(m["status"] == "active" for m in memos):
        if not memos:
            db.ex("DELETE FROM topics WHERE id=?", topic_id)
            return None
    summary = None
    proc = t["kind"] == "procedure"
    t0 = time.time()
    if llm.provider() != "heuristic" and memos:
        lines = [f"주제: {t['title']}\n", "메모:"]
        for m in memos[:60]:
            if proc and m["status"] == "superseded":
                # 절차 문서는 에이전트가 그대로 따른다. 옛 판의 명령이 섞이지 않게 본문을 넘기지 않는다(리뷰 PR #22).
                lines.append(f"- id {m['id']} [대체됨]: (옛 판. 본문은 싣지 않는다)")
                continue
            flags = []
            if m["status"] == "superseded":
                flags.append("대체됨")
            if m["trust"] == "low":
                flags.append("세션 자동 추출")
            flag = f" [{', '.join(flags)}]" if flags else ""
            when = f" (언제: {m['when_hint']})" if proc and m.get("when_hint") else ""
            lines.append(f"- id {m['id']} ({time.strftime('%Y-%m-%d', time.localtime(m['created_at']))}){flag}{when}: {m['body']}")
        owner = user_id or db.val("SELECT owner_id FROM spaces WHERE id=?", t["space_id"])
        system = llm.TOPIC_SYSTEM + (llm.TOPIC_PROCEDURE_RULES if proc else "")
        out = llm.complete_json("topic_summary", system, "\n".join(lines), llm.TOPIC_SCHEMA, owner)
        if out and out.get("summary"):
            ids = {m["id"] for m in memos}
            # 존재하지 않는 메모를 가리키는 근거 표시는 지운다.
            summary = re.sub(r"\[m:(\d+)\]", lambda mm: mm.group(0) if int(mm.group(1)) in ids else "", out["summary"]).strip()
    by = "llm" if summary else "rule"
    if not summary:
        summary = heuristic_topic_summary(memos, procedure=proc)
    db.ex("UPDATE topics SET summary=?, dirty=0, pipeline_version=?, updated_at=? WHERE id=?",
          summary, config.PIPELINE_VERSION, db.now(), topic_id)
    db.trace("topic_summary", f"{by}:t{topic_id}:{len(memos)}", ms=(time.time() - t0) * 1000)
    return summary


def merge_topics(user, keep_id, drop_id):
    a, b = db.one("SELECT * FROM topics WHERE id=?", keep_id), db.one("SELECT * FROM topics WHERE id=?", drop_id)
    if not a or not b or a["space_id"] != b["space_id"]:
        raise BadRequest("같은 공간의 주제끼리만 합칠 수 있습니다.")
    if a["kind"] != b["kind"]:
        raise BadRequest("지식 문서와 절차 문서는 합칠 수 없습니다.")
    access.require_read(user, a["space_id"])
    if db.val("SELECT kind FROM spaces WHERE id=?", a["space_id"]) == "team":
        access.require_team_admin(user, a["space_id"])
    db.ex("INSERT OR IGNORE INTO memo_topics(memo_id, topic_id) SELECT memo_id, ? FROM memo_topics WHERE topic_id=?", keep_id, drop_id)
    db.ex("DELETE FROM memo_topics WHERE topic_id=?", drop_id)
    db.ex("DELETE FROM topics WHERE id=?", drop_id)
    mark_dirty(keep_id)
    db.audit(user["id"], "topic_merge", "topic", keep_id, a["space_id"], dropped=drop_id)
    return {"ok": True, "topic_id": keep_id}


def topic_suggestions(space_id):
    """주기적 정리 제안: 제목이 거의 같은 주제는 병합, 너무 커진 주제는 분할."""
    ts = db.q("SELECT t.id, t.title, t.kind, COUNT(mt.memo_id) AS n FROM topics t LEFT JOIN memo_topics mt ON mt.topic_id=t.id "
              "WHERE t.space_id=? GROUP BY t.id", space_id)
    vecs = {t["id"]: embed.embed(t["title"]) for t in ts}
    out = []
    for i, a in enumerate(ts):
        for b in ts[i + 1:]:
            s = embed.cosine(vecs[a["id"]], vecs[b["id"]])
            if s >= 0.62 and a["kind"] == b["kind"]:
                keep, drop = (a, b) if a["n"] >= b["n"] else (b, a)
                out.append({"type": "merge", "keep": keep, "drop": drop, "similarity": round(s, 2)})
        if a["n"] >= 25:
            out.append({"type": "split", "topic": a})
    return out


# ── 팀 공간으로 올리기 ──────────────────────────────────────────────
def promote(user, memo_ids, team_space_id, ack=False, dry_run=False, note=None):
    """개인 메모를 팀 공간으로 복사한다. 원본은 그대로 남는다(이동이 아니라 출처가 붙은 복사)."""
    sp = db.one("SELECT * FROM spaces WHERE id=? AND kind='team'", team_space_id)
    if not sp:
        raise NotFound("팀 공간을 찾을 수 없습니다.")
    access.require_read(user, team_space_id)
    pid = access.personal_space_id(user["id"])
    items, warnings, blocked = [], [], []
    for mid in memo_ids:
        m = db.one("SELECT * FROM memos WHERE id=?", mid)
        if not m or m["space_id"] != pid:
            raise Forbidden("내 공간의 메모만 팀으로 올릴 수 있습니다.")
        if m["status"] != "active":
            blocked.append({"memo_id": mid, "reason": "유효한 메모가 아닙니다(대체됨·삭제됨)."})
            continue
        if m["kind"] == "state":
            blocked.append({"memo_id": mid, "reason": "진행 상태는 팀 지식으로 올리지 않습니다."})
            continue
        if m["trust"] == "low":
            blocked.append({"memo_id": mid, "reason": "세션에서 자동 추출된 후보입니다. 먼저 내용을 확인해 정식 메모로 올리세요."})
            continue
        if db.val("SELECT 1 FROM memos WHERE space_id=? AND origin_memo_id=? AND status='active'", team_space_id, mid):
            blocked.append({"memo_id": mid, "reason": "이미 이 팀에 올린 메모입니다."})
            continue
        m["_replaces"] = stale_team_copies(mid, team_space_id)
        acl = db.js(m["source_acl"], [])
        if acl:
            warnings.append({"memo_id": mid, "level": "ack", "text": f"접근 제한 문서({', '.join(acl)})에서 나온 내용이 들어 있습니다. 팀 전원이 봐도 되는지 확인하세요."})
        if m["source"] == "session":
            warnings.append({"memo_id": mid, "level": "info", "text": "세션에서 추출된 뒤 확인된 메모입니다. 세션에서 본 제한 문서의 내용이 섞이지 않았는지 살펴보세요."})
        if m["masked_count"]:
            warnings.append({"memo_id": mid, "level": "info", "text": f"민감 정보 {m['masked_count']}건이 마스킹된 메모입니다."})
        items.append(m)
    need_ack = any(w["level"] == "ack" for w in warnings)
    preview = [{"memo_id": m["id"], "body": m["body"], "kind": m["kind"],
                "topics": [r["title"] for r in db.q("SELECT t.title FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=?", m["id"])],
                "replaces": [{"memo_id": c["id"], "body": db.val("SELECT body FROM memos WHERE id=?", c["id"])} for c in m["_replaces"]]}
               for m in items]
    if dry_run or (need_ack and not ack):
        return {"dry_run": True, "team": sp["name"], "items": preview, "warnings": warnings, "blocked": blocked, "need_ack": need_ack}
    created = []
    for m in items:
        src_topic = db.one("SELECT t.id, t.title FROM topics t JOIN memo_topics mt ON mt.topic_id=t.id WHERE mt.memo_id=? LIMIT 1", m["id"])
        # 이전 판의 사본이 팀에 있으면 자동 판정(중복·갱신)에 맡기지 않고 그 사본을 대체한다.
        # 판정에 맡기면 한 단어만 바뀐 새 판이 옛 사본의 '중복'으로 합쳐져 팀에 옛 내용만 남는다.
        olds = [c["id"] for c in m["_replaces"]]
        res = remember(user, m["body"], space_id=team_space_id, scope=m["scope"], project_key=m["project_key"], kind=m["kind"],
                       source="promoted", trust="high", origin_memo_id=m["id"], source_acl=m["source_acl"],
                       topic_hint=src_topic["title"] if src_topic else None, origin_topic_id=src_topic["id"] if src_topic else None,
                       replaces_id=olds[0] if olds else None, when=m["when_hint"])
        extra = olds[1:]   # 예전 동작 탓에 사본이 둘 이상 남아 있던 경우
        for oid in extra:
            db.ex("UPDATE memos SET status='superseded', superseded_by=?, updated_at=? WHERE id=? AND status='active'", res["memo_id"], db.now(), oid)
        ev = db.one("SELECT detail FROM ingest_events WHERE id=?", res["event_id"])
        d = db.js(ev["detail"], {})
        d["also_superseded"] = extra
        db.ex("UPDATE ingest_events SET action='promote', detail=? WHERE id=?", __import__("json").dumps(d, ensure_ascii=False), res["event_id"])
        db.audit(user["id"], "promote", "memo", res["memo_id"], team_space_id, origin_memo_id=m["id"], replaced=olds,
                 acknowledged=bool(ack and need_ack), note=note)
        created.append(res)
    return {"dry_run": False, "team": sp["name"], "created": created, "warnings": warnings, "blocked": blocked,
            "message": f"{sp['name']}에 {len(created)}건을 올렸습니다."
                       + (f" 그중 {n_rep}건은 팀에 있던 이전 판을 갱신했습니다." if (n_rep := sum(1 for m in items if m['_replaces'])) else "")
                       + (f" {len(blocked)}건은 올리지 않았습니다." if blocked else "")}


def import_text(user, text, project_key=None, source_name=None):
    """기존 노트·CLAUDE.md·위키 문서를 가져온다. 문단·목록 항목 단위로 나눠 메모로 만든다."""
    chunks, cur = [], []
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^(#{1,6}\s|[-*+]\s|\d+[.)]\s)", s) or not s:
            if cur:
                chunks.append(" ".join(cur))
                cur = []
            s = re.sub(r"^([-*+]\s|\d+[.)]\s)", "", s)
            if s and not s.startswith("#"):
                cur = [s]
        else:
            cur.append(s)
    if cur:
        chunks.append(" ".join(cur))
    chunks = [c for c in chunks if len(c) >= 8][:200]
    results = [remember(user, c, project_key=project_key, source="import") for c in chunks]
    db.audit(user["id"], "import", "space", access.personal_space_id(user["id"]), count=len(results), source=source_name)
    return {"count": len(results), "results": results}
