"""Conntext 클라이언트(plugin/scripts/conntext.py) 테스트. 표준 라이브러리 unittest만 쓴다.

    python3 -m unittest discover -s tests -v

클라이언트를 실제 프로세스로 실행한다. 서버는 임시 DB로 임시 포트에 띄우고, 클라이언트의
설정 폴더(CONNTEXT_HOME)와 OpenCode 설정 폴더도 임시 폴더를 쓴다. 사용자의 실제 설정은 건드리지 않는다.
"""
import json, os, socket, subprocess, sys, tempfile, threading, time, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
os.environ["CONNTEXT_LLM"] = "heuristic"

from conntext import access, api, db, jobs, pipeline  # noqa: E402

CLIENT = ROOT / "plugin" / "scripts" / "conntext.py"
REMOTE = "git@github.com:connectivity/ble-gateway.git"
GW = "github.com/connectivity/ble-gateway"


def wait_until(fn, timeout=10.0, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


class ClientBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        db.configure(t / "t.db")
        uid = db.insert("users", email="dohyun@t", name="도현", role="user", created_at=db.now())
        access.personal_space_id(uid)
        self.user = db.one("SELECT * FROM users WHERE id=?", uid)
        _, self.token = api.issue_token(uid, "테스트")
        self.srv = api.make_server("127.0.0.1", 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        self.home = t / "home"
        self.repo = t / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "remote", "add", "origin", REMOTE], check=True)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("CONNTEXT_", "CLAUDE_", "OPENCODE_"))}
        self.env.update(CONNTEXT_HOME=str(self.home), CONNTEXT_POLL_SECONDS="0.1", PYTHONDONTWRITEBYTECODE="1")
        self.children = []

    def tearDown(self):
        for p in self.children:
            if p.poll() is None:
                p.kill()
                p.wait()
        self.srv.shutdown()
        self.srv.server_close()
        db.close()
        self.tmp.cleanup()

    def run_client(self, *args, stdin="", env=None, cwd=None, timeout=30):
        return subprocess.run([sys.executable, str(CLIENT), *args], input=stdin, capture_output=True, text=True,
                              env={**self.env, **(env or {})}, cwd=str(cwd or self.repo), timeout=timeout)

    def setup_client(self, url=None):
        r = self.run_client("setup", "--url", url or self.url, "--token", self.token)
        return r

    def hook(self, event, payload, **kw):
        return self.run_client("hook", event, stdin=json.dumps(payload), **kw)

    def session(self, ext_id, platform="claude-code"):
        return db.one("SELECT * FROM sessions WHERE ext_id=? AND platform=?", ext_id, platform)

    def transcript(self, name="t.jsonl"):
        p = Path(self.tmp.name) / name
        lines = [
            {"type": "user", "message": {"role": "user", "content": "게이트웨이 재연결 폭주 원인을 찾아 줘"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "text", "text": "원인은 ble-bridge가 mqtt-broker보다 먼저 올라오기 때문입니다. 재시작 순서를 broker 먼저로 바꿔 해결했습니다."},
                {"type": "tool_use", "name": "Bash", "input": {"command": "systemctl restart mqtt-broker"}}]}},
            {"type": "user", "message": {"role": "user", "content": "좋아. 비밀번호는 <private>hunter2-secret</private> 이야"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "text", "text": "재시작 스크립트를 수정했습니다.\n남은 일: 스테이징 장비에서 재부팅 시험"}]}},
        ]
        p.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n", encoding="utf-8")
        return p

    def write_snapshot(self, sid, text, pid=None):
        """OpenCode 플러그인이 session.idle마다 쓰는 스냅샷과 같은 모양."""
        pending = self.home / "pending"
        pending.mkdir(parents=True, exist_ok=True)
        m = pending / f"{sid}.json"
        d = {"session_id": sid, "cwd": str(self.repo), "platform": "opencode",
             "messages": [{"role": "user", "text": "게이트웨이 재시작 순서 정리해 줘", "tools": []},
                          {"role": "assistant", "text": text, "tools": ["bash: systemctl status"]}]}
        if pid:
            d["pid"] = pid
        tmp = m.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False))
        os.replace(tmp, m)
        return m

    def sleeper(self):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        self.children.append(p)
        return p

    def waiter(self, marker, after, pid=None):
        args = [sys.executable, str(CLIENT), "upload", str(marker), "--after", str(after)] + (["--pid", str(pid)] if pid else [])
        p = subprocess.Popen(args, env=self.env, cwd=str(self.repo), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(p)
        return p


class TestSetup(ClientBase):
    def test_setup_and_status(self):
        r = self.setup_client()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("연결됨", r.stdout)
        self.assertIn("도현 <dohyun@t>", r.stdout)
        self.assertIn(f"이 폴더의 저장소: {REMOTE}", r.stdout)
        self.assertIn("세션 기록: 켜짐", r.stdout)
        cfg = self.home / "config.json"
        self.assertEqual(json.loads(cfg.read_text()), {"url": self.url, "token": self.token})
        self.assertEqual(cfg.stat().st_mode & 0o777, 0o600)

        self.assertEqual(self.run_client("pause").returncode, 0)
        self.assertIn("세션 기록: 꺼짐(이 장비)", self.run_client("status").stdout)
        self.run_client("unpause")
        self.assertIn("세션 기록: 켜짐", self.run_client("status").stdout)

    def test_status_reports_bad_token_and_missing_setup(self):
        r = self.run_client("status")
        self.assertEqual(r.returncode, 1)
        self.assertIn("설정이 없습니다", r.stdout)
        r = self.run_client("setup", "--url", self.url, "--token", "ctx_wrong")
        self.assertEqual(r.returncode, 1)
        self.assertIn("토큰이 유효하지 않습니다", r.stdout)

    def test_install_opencode_uses_opencode_command_names(self):
        self.setup_client()
        oc = Path(self.tmp.name) / "oc"
        (oc).mkdir()
        (oc / "opencode.json").write_text(json.dumps({"model": "x/y"}))
        r = self.run_client("install", "opencode", env={"OPENCODE_CONFIG_DIR": str(oc)})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.home / "bin" / "conntext.py").exists())
        self.assertTrue((oc / "plugins" / "conntext.js").exists())
        cfg = json.loads((oc / "opencode.json").read_text())
        self.assertEqual(cfg["model"], "x/y")
        self.assertEqual(cfg["mcp"]["conntext"]["command"][1:], [str(self.home / "bin" / "conntext.py"), "mcp"])
        for name in ("remember", "recall", "resume", "handoff", "forget"):
            text = (oc / "commands" / f"{name}.md").read_text()
            self.assertNotIn("/conntext:", text, name)
            self.assertTrue(text.startswith("---\ndescription: "), name)
        self.assertIn("/recall", (oc / "commands" / "recall.md").read_text())
        self.assertIn("`/handoff`", (oc / "commands" / "resume.md").read_text())


class TestHooks(ClientBase):
    def setUp(self):
        super().setUp()
        self.setup_client()

    def test_session_start_prints_context_json(self):
        pipeline.remember(self.user, "답변은 항상 한국어로 해 줘")
        r = self.hook("session-start", {"session_id": "s1", "cwd": str(self.repo), "transcript_path": "/nonexistent.jsonl",
                                        "source": "startup"})
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("답변은 항상 한국어로 해 줘", ctx)
        self.assertIn(f"이 세션의 Conntext project: {GW}", ctx)
        s = self.session("s1")
        self.assertEqual((s["status"], s["project_key"]), ("open", GW))
        self.assertTrue((self.home / "pending" / "s1.json").exists())

    def test_session_end_uploads_and_extracts(self):
        tp = self.transcript()
        payload = {"session_id": "s2", "cwd": str(self.repo), "transcript_path": str(tp)}
        self.hook("session-start", payload)
        r = self.hook("session-end", {**payload, "reason": "exit"})
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        # 업로드는 분리된 프로세스가 한다. 훅은 기다리지 않는다.
        s = wait_until(lambda: (self.session("s2") or {}).get("status") == "uploaded" and self.session("s2"))
        self.assertTrue(s, "업로드되지 않았습니다")
        self.assertIn("ble-bridge", s["transcript"])
        self.assertNotIn("hunter2-secret", s["transcript"])
        self.assertTrue(wait_until(lambda: not (self.home / "pending" / "s2.json").exists()))
        jobs.drain()
        s = self.session("s2")
        self.assertEqual(s["status"], "extracted")
        self.assertIn("게이트웨이", s["summary"])
        state = db.one("SELECT body FROM memos WHERE kind='state' AND status='active' AND project_key=?", GW)
        self.assertIn("스테이징", state["body"])

    def test_server_down_hooks_exit_quietly(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            dead = f"http://127.0.0.1:{s.getsockname()[1]}"
        tp = self.transcript()
        env = {"CONNTEXT_URL": dead}
        t0 = time.time()
        for event in ("session-start", "pre-compact", "session-end"):
            r = self.hook(event, {"session_id": "s3", "cwd": str(self.repo), "transcript_path": str(tp)}, env=env)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""), event)
        self.assertLess(time.time() - t0, 10)
        r = self.run_client("hook", "session-start", stdin="not json", env=env)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        log = self.home / "client.log"
        self.assertTrue(wait_until(lambda: log.exists() and "upload s3" in log.read_text()), "업로드 실패가 기록되지 않았습니다")
        self.assertIn("hook session-start", log.read_text())
        # 올리지 못한 세션은 마커가 남아 다음에 다시 시도된다.
        self.assertTrue((self.home / "pending" / "s3.json").exists())

    def test_no_config_hooks_exit_quietly(self):
        (self.home / "config.json").unlink()
        r = self.hook("session-start", {"session_id": "s4", "cwd": str(self.repo)})
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))


class TestCheckpoint(ClientBase):
    """대화 중 N턴마다 체크포인트(#18)."""
    def setUp(self):
        super().setUp()
        self.setup_client()

    def append(self, tp, user, agent):
        with open(tp, "a", encoding="utf-8") as f:
            f.write(json.dumps({"type": "user", "message": {"role": "user", "content": user}}, ensure_ascii=False) + "\n")
            f.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": agent}]}},
                               ensure_ascii=False) + "\n")

    def test_turn_hook_uploads_checkpoint_every_n_turns(self):
        db.set_policy("capture", {**db.DEFAULT_POLICIES["capture"], "checkpoint_turns": 2})
        tp = self.transcript()
        payload = {"session_id": "c1", "cwd": str(self.repo), "transcript_path": str(tp)}
        self.hook("session-start", payload)
        self.assertEqual(json.loads((self.home / "policy.json").read_text())["checkpoint_turns"], 2)
        r = self.hook("turn", payload)
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        time.sleep(0.5)
        self.assertIsNone(self.session("c1")["transcript"])          # 1턴: 아직 올리지 않는다
        self.hook("turn", payload)                                     # 2턴: 체크포인트
        s = wait_until(lambda: (self.session("c1") or {}).get("transcript") and self.session("c1"))
        self.assertTrue(s, "체크포인트가 올라가지 않았습니다")
        self.assertEqual(s["status"], "open")                          # 세션은 아직 진행 중
        jobs.drain()
        s = self.session("c1")
        self.assertEqual((s["checkpoints"], s["status"]), (1, "open"))
        state = db.one("SELECT body FROM memos WHERE kind='state' AND status='active' AND project_key=?", GW)
        self.assertIn("스테이징", state["body"])                      # 세션이 끝나기 전에 진행 상태가 갱신된다
        n_cands = db.val("SELECT COUNT(*) FROM memos WHERE origin_session_id=? AND kind!='state'", s["id"])
        # 대화가 이어진 뒤 다음 체크포인트는 새 부분만 본다
        self.append(tp, "OTA 청크 재전송을 고쳐 줘", "원인은 청크 크기를 MTU 한도 이상으로 잡았기 때문입니다. 244바이트로 줄여 해결했습니다.\n남은 일: 실기기 시험")
        self.hook("turn", payload)
        self.hook("turn", payload)
        self.assertTrue(wait_until(lambda: "OTA 청크" in (self.session("c1")["transcript"] or "")))
        jobs.drain()
        s = self.session("c1")
        self.assertEqual(s["checkpoints"], 2)
        bodies = [r["body"] for r in db.q("SELECT body FROM memos WHERE origin_session_id=? AND kind!='state'", s["id"])]
        self.assertEqual(len(bodies), len(set(bodies)))                # 같은 후보를 되풀이하지 않는다
        self.assertGreater(len(bodies), n_cands)
        self.assertIn("실기기", db.one("SELECT body FROM memos WHERE kind='state' AND status='active' AND project_key=?", GW)["body"])
        # 세션이 끝나면 남은 부분만 보고 마무리한다
        self.hook("session-end", {**payload, "reason": "exit"})
        self.assertTrue(wait_until(lambda: self.session("c1")["status"] == "uploaded"))
        jobs.drain()
        self.assertEqual(self.session("c1")["status"], "extracted")
        self.assertFalse((self.home / "pending" / "c1.json.turns").exists())

    def test_turn_hook_off_when_policy_zero_or_unknown(self):
        tp = self.transcript()
        payload = {"session_id": "c2", "cwd": str(self.repo), "transcript_path": str(tp)}
        for _ in range(12):                                            # 서버가 간격을 알려 준 적이 없다(옛 서버)
            self.assertEqual(self.hook("turn", payload).returncode, 0)
        db.set_policy("capture", {**db.DEFAULT_POLICIES["capture"], "checkpoint_turns": 0})
        self.hook("session-start", payload)
        for _ in range(12):
            self.hook("turn", payload)
        time.sleep(0.5)
        self.assertIsNone(self.session("c2")["transcript"])


class TestOptOut(ClientBase):
    def setUp(self):
        super().setUp()
        self.setup_client()
        self.tp = self.transcript()

    def requests_seen(self):
        return db.val("SELECT COUNT(*) FROM injections", default=0) + db.val("SELECT COUNT(*) FROM sessions", default=0)

    def run_session(self, sid, **kw):
        payload = {"session_id": sid, "cwd": str(self.repo), "transcript_path": str(self.tp)}
        a = self.hook("session-start", payload, **kw)
        b = self.hook("session-end", payload, **kw)
        self.assertEqual((a.returncode, b.returncode), (0, 0))
        time.sleep(1.5)       # 분리된 업로드 프로세스가 있었다면 끝날 시간
        return a

    def test_env_off_sends_nothing(self):
        r = self.run_session("o1", env={"CONNTEXT_OFF": "1"})
        self.assertEqual(r.stdout, "")
        self.assertEqual(self.requests_seen(), 0)
        self.assertFalse((self.home / "pending").exists() and any((self.home / "pending").iterdir()))

    def test_repo_off_file_sends_nothing(self):
        (self.repo / ".conntext-off").write_text("")
        sub = self.repo / "sub"
        sub.mkdir()
        payload = {"session_id": "o2", "cwd": str(sub), "transcript_path": str(self.tp)}
        self.assertEqual(self.hook("session-start", payload).stdout, "")
        self.hook("session-end", payload)
        time.sleep(1.5)
        self.assertEqual(self.requests_seen(), 0)

    def test_device_pause_uploads_nothing(self):
        pipeline.remember(self.user, "답변은 항상 한국어로 해 줘")
        self.run_client("pause")
        r = self.run_session("o3")
        # 메모 조회는 그대로 된다.
        ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("한국어", ctx)
        self.assertIn("세션 기록이 꺼져 있습니다", ctx)
        # 세션 id, 경로, 대화록은 서버에 가지 않는다.
        self.assertEqual(db.q("SELECT id FROM sessions"), [])
        self.assertEqual(db.val("SELECT session_ext_id FROM injections"), "")
        self.assertEqual(list((self.home / "pending").glob("*.json")), [])

    def test_pause_blocks_delayed_upload(self):
        self.run_client("pause")
        m = self.write_snapshot("ses_p", "재시작 순서는 broker 먼저입니다.")
        p = self.waiter(m, 60, pid=999999)        # 이미 끝난 프로세스: 바로 올릴 차례
        p.wait(timeout=10)
        self.assertEqual(db.q("SELECT id FROM sessions"), [])
        self.assertFalse(m.exists())

    def test_mcp_does_not_fill_project_when_repo_off(self):
        (self.repo / ".conntext-off").write_text("")
        out = self.mcp([{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": "remember", "arguments": {"text": "브로커 포트는 1883"}}}])
        self.assertFalse(out[0]["result"]["isError"])
        self.assertIsNone(db.val("SELECT project_key FROM memos"))

    def mcp(self, msgs):
        r = self.run_client("mcp", stdin="".join(json.dumps(m, ensure_ascii=False) + "\n" for m in msgs))
        return [json.loads(line) for line in r.stdout.splitlines() if line.strip()]


class TestMcpProxy(ClientBase):
    def mcp(self, msgs, **kw):
        r = self.run_client("mcp", stdin="".join(json.dumps(m, ensure_ascii=False) + "\n" for m in msgs), **kw)
        self.assertEqual(r.returncode, 0, r.stderr)
        return [json.loads(line) for line in r.stdout.splitlines() if line.strip()]

    def test_fills_project_argument(self):
        self.setup_client()
        out = self.mcp([
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "remember", "arguments": {"text": "재시작 순서는 mqtt-broker 먼저, 그다음 ble-bridge"}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "remember", "arguments": {"text": "OTA 서버 포트는 8443", "project": "github.com/connectivity/ota-service"}}},
        ])
        self.assertEqual([o["id"] for o in out], [1, 2, 3])       # 알림에는 응답하지 않는다
        self.assertEqual(out[0]["result"]["serverInfo"]["name"], "conntext")
        self.assertFalse(out[1]["result"]["isError"], out[1])
        rows = {r["body"]: r["project_key"] for r in db.q("SELECT body, project_key FROM memos")}
        self.assertEqual(rows["재시작 순서는 mqtt-broker 먼저, 그다음 ble-bridge"], GW)
        # 에이전트가 넣은 project는 덮어쓰지 않는다.
        self.assertEqual(rows["OTA 서버 포트는 8443"], "github.com/connectivity/ota-service")

    def test_reports_errors_as_jsonrpc(self):
        out = self.mcp([{"jsonrpc": "2.0", "id": 7, "method": "tools/list"}], env={"CONNTEXT_URL": self.url, "CONNTEXT_TOKEN": "ctx_bad"})
        self.assertEqual(out[0]["id"], 7)
        self.assertIn("토큰이 유효하지 않습니다", out[0]["error"]["message"])
        out = self.mcp([{"jsonrpc": "2.0", "id": 8, "method": "tools/list"}])     # 설정 없음
        self.assertEqual(out[0]["id"], 8)
        self.assertIn("error", out[0])


class TestDelayedUpload(ClientBase):
    """OpenCode용 지연 업로드: conntext.py upload <marker> --after N [--pid P]"""

    def setUp(self):
        super().setUp()
        self.setup_client()

    def test_waits_and_skips_while_snapshot_is_refreshed(self):
        agent = self.sleeper()
        m = self.write_snapshot("ses_a", "첫 응답", pid=agent.pid)
        first = self.waiter(m, 2, pid=agent.pid)
        time.sleep(1.2)
        # 대화가 이어져 스냅샷이 새로 쓰였다. 새로 띄운 대기 프로세스는 바로 끝나고, 앞의 것이 기다림을 연장한다.
        m = self.write_snapshot("ses_a", "두 번째 응답: 재시작 순서는 broker 먼저입니다.", pid=agent.pid)
        second = self.waiter(m, 2, pid=agent.pid)
        self.assertEqual(second.wait(timeout=5), 0)
        time.sleep(1.3)           # 첫 스냅샷 기준으로는 기한이 지났다
        self.assertIsNone(first.poll())
        self.assertIsNone(self.session("ses_a", "opencode"))
        self.assertEqual(first.wait(timeout=10), 0)
        s = self.session("ses_a", "opencode")
        self.assertEqual(s["status"], "uploaded")
        self.assertIn("두 번째 응답", s["transcript"])
        self.assertFalse(m.exists())
        self.assertEqual(list((self.home / "pending").iterdir()), [])      # 잠금 파일도 남지 않는다

    def test_uploads_right_away_when_agent_exits(self):
        agent = self.sleeper()
        m = self.write_snapshot("ses_b", "재시작 순서는 broker 먼저입니다.", pid=agent.pid)
        w = self.waiter(m, 600, pid=agent.pid)
        time.sleep(0.5)
        self.assertIsNone(w.poll())
        agent.kill()
        agent.wait()
        self.assertEqual(w.wait(timeout=10), 0)
        self.assertEqual(self.session("ses_b", "opencode")["status"], "uploaded")
        jobs.drain()
        self.assertEqual(self.session("ses_b", "opencode")["status"], "extracted")

    def test_waiter_started_before_snapshot(self):
        # 플러그인은 스냅샷을 쓰기 전에 대기 프로세스를 먼저 띄운다.
        agent = self.sleeper()
        m = self.home / "pending" / "ses_c.json"
        w = self.waiter(m, 600, pid=agent.pid)
        time.sleep(0.4)
        self.write_snapshot("ses_c", "재시작 순서는 broker 먼저입니다.", pid=agent.pid)
        agent.kill()
        agent.wait()
        self.assertEqual(w.wait(timeout=10), 0)
        self.assertEqual(self.session("ses_c", "opencode")["status"], "uploaded")

    def test_no_snapshot_and_agent_gone_exits(self):
        agent = self.sleeper()
        w = self.waiter(self.home / "pending" / "ses_d.json", 600, pid=agent.pid)
        agent.kill()
        agent.wait()
        self.assertEqual(w.wait(timeout=10), 0)
        self.assertEqual(db.q("SELECT id FROM sessions"), [])

    def test_failed_upload_keeps_snapshot(self):
        m = self.write_snapshot("ses_e", "재시작 순서는 broker 먼저입니다.")
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            dead = f"http://127.0.0.1:{s.getsockname()[1]}"
        self.env["CONNTEXT_URL"] = dead
        import importlib.util
        spec = importlib.util.spec_from_file_location("ctx_client", CLIENT)
        # 재시도 간격을 줄이기 위해 모듈을 직접 불러 실행한다.
        old_env = dict(os.environ)
        os.environ.update(self.env)
        try:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.RETRY_SECONDS = (0.1,)
            self.assertEqual(mod.cmd_wait_upload(m, 0), 1)
        finally:
            os.environ.clear()
            os.environ.update(old_env)
        self.assertTrue(m.exists())
        self.assertFalse(Path(str(m) + ".lock").exists())
        self.assertIn("upload ses_e", (self.home / "client.log").read_text())


if __name__ == "__main__":
    unittest.main()
