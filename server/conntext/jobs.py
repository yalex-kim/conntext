"""SQLite 테이블 기반 작업 대기열. 서버 프로세스 안의 워커 스레드 하나가 처리한다."""
import json, threading, time, traceback
from . import db

_handlers = {}
_stop = threading.Event()
_thread = None
_last_maintenance = 0


def handler(kind):
    def deco(fn):
        _handlers[kind] = fn
        return fn
    return deco


def enqueue(kind, payload, dedupe=False):
    p = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if dedupe and db.val("SELECT 1 FROM jobs WHERE kind=? AND payload=? AND status='queued'", kind, p):
        return None
    return db.insert("jobs", kind=kind, payload=p, created_at=db.now())


def run_one():
    job = db.one("SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1")
    if not job:
        return False
    db.ex("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", db.now(), job["id"])
    try:
        fn = _handlers.get(job["kind"])
        if not fn:
            raise RuntimeError(f"알 수 없는 작업: {job['kind']}")
        fn(json.loads(job["payload"]))
        db.ex("UPDATE jobs SET status='done', finished_at=? WHERE id=?", db.now(), job["id"])
    except Exception as e:
        status = "queued" if job["attempts"] + 1 < 3 else "failed"
        db.ex("UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?", status,
              f"{type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}", db.now(), job["id"])
    return True


def drain(limit=1000):
    n = 0
    while n < limit and run_one():
        n += 1
    return n


def _loop(maintenance, interval):
    global _last_maintenance
    while not _stop.is_set():
        try:
            if not run_one():
                if maintenance and time.time() - _last_maintenance > interval:
                    _last_maintenance = time.time()
                    maintenance()
                _stop.wait(0.5)
        except Exception:
            _stop.wait(2)


def start(maintenance=None, interval=600):
    global _thread
    _stop.clear()
    # 이전 프로세스가 처리 중에 죽어서 남은 작업을 다시 대기열로 돌린다.
    db.ex("UPDATE jobs SET status='queued' WHERE status='running'")
    _thread = threading.Thread(target=_loop, args=(maintenance, interval), daemon=True, name="conntext-jobs")
    _thread.start()


def stop():
    _stop.set()


def stats():
    now = db.now()
    oldest = db.val("SELECT MIN(created_at) FROM jobs WHERE status='queued'")
    return {
        "queued": db.val("SELECT COUNT(*) FROM jobs WHERE status='queued'", default=0),
        "running": db.val("SELECT COUNT(*) FROM jobs WHERE status='running'", default=0),
        "failed_24h": db.val("SELECT COUNT(*) FROM jobs WHERE status='failed' AND finished_at>=?", now - 86400, default=0),
        "done_24h": db.val("SELECT COUNT(*) FROM jobs WHERE status='done' AND finished_at>=?", now - 86400, default=0),
        "lag_seconds": (now - oldest) if oldest else 0,
    }
