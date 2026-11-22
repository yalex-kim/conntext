"""SQLite 접근 계층. 스레드마다 연결 하나, WAL 모드."""
import json, sqlite3, threading, time
from pathlib import Path
from . import config

_local = threading.local()
_path = None
_write_lock = threading.RLock()


def configure(path=None):
    global _path
    _path = str(path or config.DB_PATH)
    if _path != ":memory:":
        Path(_path).parent.mkdir(parents=True, exist_ok=True)
    close()
    conn().executescript((Path(__file__).parent / "schema.sql").read_text())
    _migrate()
    conn().commit()


# 기존 DB에 없는 열을 더한다. CREATE TABLE IF NOT EXISTS는 이미 있는 표를 고치지 않는다.
MIGRATIONS = [
    ("memos", "when_hint", "TEXT"),
    ("topics", "kind", "TEXT NOT NULL DEFAULT 'knowledge'"),
]


def _migrate():
    c = conn()
    for table, col, decl in MIGRATIONS:
        if col not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def conn():
    c = getattr(_local, "c", None)
    if c is None or getattr(_local, "path", None) != _path:
        c = sqlite3.connect(_path, timeout=30, check_same_thread=False, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=OFF")
        c.execute("PRAGMA busy_timeout=30000")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.c, _local.path = c, _path
    return c


def close():
    c = getattr(_local, "c", None)
    if c is not None:
        c.close()
        _local.c = None


def now():
    return int(time.time())


def q(sql, *args):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def one(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def val(sql, *args, default=None):
    r = conn().execute(sql, args).fetchone()
    return r[0] if r and r[0] is not None else default


def ex(sql, *args):
    with _write_lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid


def insert(table, **cols):
    keys = list(cols)
    sql = f"INSERT INTO {table}({','.join(keys)}) VALUES({','.join('?' * len(keys))})"
    return ex(sql, *[_enc(cols[k]) for k in keys])


def update(table, id_, **cols):
    keys = list(cols)
    ex(f"UPDATE {table} SET {','.join(k + '=?' for k in keys)} WHERE id=?", *[_enc(cols[k]) for k in keys], id_)


def _enc(v):
    return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v


def js(v, default=None):
    if v is None or v == "":
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


# ── 정책 ────────────────────────────────────────────────────────────
DEFAULT_POLICIES = {
    "masking_rules": [
        {"name": "AWS 액세스 키", "pattern": r"AKIA[0-9A-Z]{16}"},
        {"name": "비밀키 블록", "pattern": r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"},
        {"name": "토큰·비밀번호 대입", "pattern": r"(?i)\b(api[_-]?key|secret|token|passwd|password|비밀번호)\b(\s*[:=]\s*)(['\"]?)[^\s'\"]{8,}\3"},
        {"name": "Bearer 토큰", "pattern": r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}"},
        {"name": "GitHub 토큰", "pattern": r"gh[pousr]_[A-Za-z0-9]{30,}"},
        {"name": "주민등록번호", "pattern": r"\b\d{6}-[1-4]\d{6}\b"},
        {"name": "휴대전화 번호", "pattern": r"\b01[016789]-?\d{3,4}-?\d{4}\b"},
    ],
    "capture": {"platforms": ["claude-code", "opencode", "connpass"], "excluded_projects": [], "max_transcript_chars": 400000},
    "retention": {"transcript_days": 90, "candidate_days": 30, "state_days": 14, "candidate_promote_uses": 2},
    "injection": {"token_budget": 1500, "max_instructions": 12, "instruction_chars": 1200, "max_procedures": 20, "max_topics": 40},
    # 예산을 넘으면 최근 24시간 사용량이 다시 예산 아래로 내려갈 때까지 규칙 기반으로 처리한다(llm._over_budget).
    "budget": {"daily_tokens_per_user": 400000},
    "clients": {"min_plugin_version": config.MIN_PLUGIN_VERSION},
}


# 서버가 읽지 않게 된 정책 항목. 예전에 저장된 값이 있어도 내려주지 않고, 저장 요청에서도 버린다.
RETIRED_POLICY_KEYS = {"budget": ("on_exceed",)}


def policy(key):
    row = one("SELECT value FROM policies WHERE key=?", key)
    base = DEFAULT_POLICIES.get(key)
    if not row:
        return json.loads(json.dumps(base))
    v = js(row["value"], base)
    if isinstance(base, dict) and isinstance(v, dict):
        return {k: x for k, x in {**base, **v}.items() if k not in RETIRED_POLICY_KEYS.get(key, ())}
    return v


def set_policy(key, value, actor_id=None):
    ex("INSERT INTO policies(key,value,updated_at,updated_by) VALUES(?,?,?,?) "
       "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
       key, json.dumps(value, ensure_ascii=False), now(), actor_id)


def audit(actor_id, action, target_type=None, target_id=None, space_id=None, **detail):
    insert("audit_log", actor_id=actor_id, action=action, target_type=target_type,
           target_id=None if target_id is None else str(target_id), space_id=space_id,
           detail=detail, created_at=now())


def metric(kind, name, value=0.0, tokens_in=0, tokens_out=0, user_id=None, ok=True):
    insert("metrics", kind=kind, name=name, value=float(value), tokens_in=int(tokens_in), tokens_out=int(tokens_out),
           user_id=user_id, ok=1 if ok else 0, created_at=now())


def trace(stage, result, memo_id=None, session_id=None, ms=0.0):
    insert("trace", memo_id=memo_id, session_id=session_id, stage=stage, result=str(result)[:200], ms=ms, created_at=now())
