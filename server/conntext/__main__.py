"""실행: python3 -m conntext [serve|seed|token|reprocess]"""
import argparse, sys
from . import access, api, config, db, jobs, llm, seed, sessions


def bootstrap():
    db.configure()
    if not db.val("SELECT COUNT(*) FROM users", default=0):
        import os
        email = os.environ.get("CONNTEXT_ADMIN_EMAIL", "admin@conn.example")
        uid = db.insert("users", email=email, name="운영자", role="operator", created_at=db.now())
        access.personal_space_id(uid)
        print(f"[conntext] 첫 실행: 운영자 계정을 만들었습니다 ({email})")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="conntext")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="서버 실행")
    s.add_argument("--host", default=None)
    s.add_argument("--port", type=int, default=None)
    s.add_argument("--demo", action="store_true", help="DB가 비어 있으면 데모 데이터를 넣는다")
    s.add_argument("-v", "--verbose", action="store_true")
    d = sub.add_parser("seed", help="데모 데이터 넣기(합성 데이터)")
    d.add_argument("--reset", action="store_true", help="기존 DB를 지우고 다시 만든다")
    t = sub.add_parser("token", help="사용자의 클라이언트 토큰 발급")
    t.add_argument("email")
    t.add_argument("--label", default="CLI 발급")
    a = ap.parse_args(argv)
    cmd = a.cmd or "serve"

    if cmd == "seed":
        if a.reset and config.DB_PATH.exists():
            for suffix in ("", "-wal", "-shm"):
                p = config.DB_PATH.with_name(config.DB_PATH.name + suffix)
                if p.exists():
                    p.unlink()
        db.configure()
        seed.run()
        return 0
    if cmd == "token":
        db.configure()
        u = db.one("SELECT id FROM users WHERE email=?", a.email)
        if not u:
            print("등록되지 않은 사용자입니다.", file=sys.stderr)
            return 1
        _, tok = api.issue_token(u["id"], a.label)
        print(tok)
        return 0

    db.configure()
    if getattr(a, "demo", False) and not db.val("SELECT COUNT(*) FROM users", default=0):
        seed.run()
    bootstrap()
    jobs.start(sessions.maintenance)
    srv = api.make_server(getattr(a, "host", None), getattr(a, "port", None), getattr(a, "verbose", False))
    host, port = srv.server_address[:2]
    print(f"[conntext] http://{host}:{port}  ·  LLM: {llm.provider()} ({llm.model_name()})  ·  DB: {config.DB_PATH}", flush=True)
    if config.DEV_LOGIN:
        print("[conntext] 개발용 로그인이 켜져 있습니다(CONNTEXT_DEV_LOGIN=1). 사내 망 밖에 노출하지 마세요.", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        jobs.stop()
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
