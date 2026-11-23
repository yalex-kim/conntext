#!/usr/bin/env python3
"""Conntext 클라이언트. 표준 라이브러리만 쓴다.

  conntext.py setup --url URL --token TOKEN   서버 주소와 토큰 저장 (~/.conntext/config.json)
  conntext.py status                          연결 상태 확인
  conntext.py pause | unpause                 이 장비의 세션 기록 끄기/켜기
  conntext.py install opencode                OpenCode에 플러그인·명령어·MCP 설치
  conntext.py hook <event>                    에이전트 훅 진입점 (stdin으로 훅 JSON)
  conntext.py mcp                             stdio MCP 프록시 (서버 /mcp로 중계)
  conntext.py upload <marker.json>            세션 대화록 업로드 (훅이 백그라운드로 실행)
  conntext.py hook turn                       응답 한 번이 끝날 때(Stop). N턴마다 체크포인트를 올린다
  conntext.py hook prompt                     질문을 보낼 때(UserPromptSubmit). 관련 메모가 있으면 맥락에 넣는다
  conntext.py upload <marker.json> --checkpoint [--reason R]
                                              비최종 업로드(맥락 압축 직전, 대화 중 체크포인트)
  conntext.py upload <marker.json> --after N [--pid P]
                                              지연 업로드: 스냅샷이 N초 동안 그대로이거나 프로세스 P가 끝나면 올린다
                                              (OpenCode 플러그인이 session.idle마다 실행. 세션마다 대기 프로세스는 하나)

훅은 에이전트를 절대 막지 않는다. 실패하면 조용히 끝내고 ~/.conntext/client.log에 남긴다.
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

VERSION = "0.2.0"
HOME = Path(os.environ.get("CONNTEXT_HOME", Path.home() / ".conntext"))
CONFIG, PENDING, PAUSED, LOG = HOME / "config.json", HOME / "pending", HOME / "paused", HOME / "client.log"
ACTIVE = HOME / "active"                 # OpenCode 플러그인이 쓰는 '이 프로세스의 지금 세션'(파일 이름이 OpenCode pid)
SERVER_POLICY = HOME / "policy.json"     # 세션 시작 때 서버가 알려 준 클라이언트 정책(체크포인트 간격)
PRIVATE = re.compile(r"<private>[\s\S]*?</private>", re.I)
MAX_TRANSCRIPT_BYTES = 3 * 1024 * 1024
STALE_SECONDS = 6 * 3600
POLL_SECONDS = float(os.environ.get("CONNTEXT_POLL_SECONDS") or 2)
RETRY_SECONDS = (10, 30)
PROMPT_TIMEOUT = float(os.environ.get("CONNTEXT_PROMPT_TIMEOUT") or 2.5)   # 질문마다 관련 메모를 기다리는 최대 시간          # 지연 업로드가 실패했을 때 다시 시도하는 간격


def log(msg):
    try:
        HOME.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 512 * 1024:
            LOG.write_text("")
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


def config():
    c = {}
    try:
        c = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        pass
    url = os.environ.get("CONNTEXT_URL") or c.get("url") or ""
    tok = os.environ.get("CONNTEXT_TOKEN") or c.get("token") or ""
    return url.rstrip("/"), tok


def platform_name():
    return os.environ.get("CONNTEXT_PLATFORM") or "claude-code"


def request(path, body=None, timeout=5.0, method=None):
    url, tok = config()
    if not url or not tok:
        raise RuntimeError("설정이 없습니다. `conntext.py setup --url … --token …`을 먼저 실행하세요.")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method or ("POST" if data is not None else "GET"), headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {tok}",
        "X-Conntext-Client": f"{platform_name()}/{VERSION}",
        **({"X-Conntext-Session": os.environ["CONNTEXT_SESSION"]} if os.environ.get("CONNTEXT_SESSION") else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def git(cwd, *args):
    try:
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=3)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def project_of(cwd):
    """저장소 식별자: git 원격 주소. 원격이 없으면 저장소 최상위 폴더 이름."""
    cwd = cwd or os.getcwd()
    remote = git(cwd, "config", "--get", "remote.origin.url")
    if remote:
        return remote
    top = git(cwd, "rev-parse", "--show-toplevel")
    return "local:" + os.path.basename(top or cwd)


def opted_out(cwd):
    """이 저장소에서 Conntext를 아예 쓰지 않는가."""
    if os.environ.get("CONNTEXT_OFF") == "1":
        return True
    top = git(cwd or os.getcwd(), "rev-parse", "--show-toplevel") or cwd or os.getcwd()
    return (Path(top) / ".conntext-off").exists()


# ── 훅 ──────────────────────────────────────────────────────────────
def marker_path(session_id):
    return PENDING / (re.sub(r"[^A-Za-z0-9_.-]", "_", session_id)[:120] + ".json")


def turns_path(marker):
    return Path(str(marker) + ".turns")


def spawn_upload(marker, final=True, reason=None):
    args = [sys.executable, os.path.abspath(__file__), "upload", str(marker)] + ([] if final else ["--checkpoint"]) \
        + (["--reason", reason] if reason else [])
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = 0x00000008 | 0x00000200      # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    subprocess.Popen(args, **kw)


def hook_session_start(inp):
    cwd = inp.get("cwd") or os.getcwd()
    sid = inp.get("session_id") or ""
    project = project_of(cwd)
    paused = PAUSED.exists()
    # 종료 훅이 불리지 않고 끝난 이전 세션을 뒤늦게 올린다(터미널을 그냥 닫은 경우).
    try:
        PENDING.mkdir(parents=True, exist_ok=True)
        now = time.time()
        for m in PENDING.glob("*.json"):
            try:
                d = json.loads(m.read_text())
                tp = d.get("transcript_path")
                last = os.path.getmtime(tp) if tp and os.path.exists(tp) else m.stat().st_mtime
                if d.get("session_id") != sid and now - last > STALE_SECONDS:
                    spawn_upload(m)
            except (OSError, ValueError):
                continue
        # 끝난 OpenCode 프로세스의 '지금 세션' 표시를 지운다.
        if ACTIVE.exists():
            for a in ACTIVE.glob("*.json"):
                if a.stem.isdigit() and not pid_alive(int(a.stem)):
                    a.unlink(missing_ok=True)
        if sid and inp.get("transcript_path") and not paused:
            marker_path(sid).write_text(json.dumps({"session_id": sid, "transcript_path": inp["transcript_path"], "cwd": cwd,
                                                    "project": project, "platform": platform_name()}))
    except OSError as e:
        log(f"marker: {e}")
    # 기록을 꺼 두었으면 맥락 조회에 필요한 저장소 식별자만 보낸다. 세션 id와 경로는 보내지 않는다.
    res = request("/api/hooks/session-start", {"platform": platform_name(), "session_id": "" if paused else sid,
                                               "cwd": None if paused else cwd, "project": project,
                                               "source": inp.get("source")}, timeout=4.0)
    ctx = (res or {}).get("context") or ""
    if res and "checkpoint_turns" in res:
        try:
            SERVER_POLICY.write_text(json.dumps({"checkpoint_turns": res["checkpoint_turns"]}))
        except OSError as e:
            log(f"policy: {e}")
    if paused and ctx:
        ctx += "\n(이 장비에서는 세션 기록이 꺼져 있습니다.)\n"
    if ctx:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ctx}}, ensure_ascii=False))


def hook_upload(inp, final):
    sid = inp.get("session_id") or ""
    if not sid or PAUSED.exists():
        if final and sid:
            marker_path(sid).unlink(missing_ok=True)
            turns_path(marker_path(sid)).unlink(missing_ok=True)
        return
    m = marker_path(sid)
    if not m.exists():
        cwd = inp.get("cwd") or os.getcwd()
        PENDING.mkdir(parents=True, exist_ok=True)
        m.write_text(json.dumps({"session_id": sid, "transcript_path": inp.get("transcript_path"), "cwd": cwd,
                                 "project": project_of(cwd), "platform": platform_name()}))
    d = json.loads(m.read_text())
    d["reason"] = inp.get("reason") or inp.get("trigger") or ""
    m.write_text(json.dumps(d))
    spawn_upload(m, final)


def hook_prompt(inp, event_name="UserPromptSubmit"):
    """질문마다 관련 메모(#12). 서버가 관련도가 충분한 메모만 돌려주고, 없으면 아무것도 넣지 않는다.
    질문을 늦추지 않도록 짧게 기다리고, 실패하면 조용히 넘어간다. 질문 원문은 서버에 저장되지 않는다."""
    prompt = PRIVATE.sub(" ", inp.get("prompt") or "").strip()
    if len(prompt) < 6 or prompt.startswith("/"):
        return
    cwd = inp.get("cwd") or os.getcwd()
    paused = PAUSED.exists()
    res = request("/api/hooks/prompt", {"platform": platform_name(), "session_id": "" if paused else (inp.get("session_id") or ""),
                                        "project": project_of(cwd), "prompt": prompt[:4000]}, timeout=PROMPT_TIMEOUT)
    ctx = (res or {}).get("context") or ""
    if ctx:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": event_name, "additionalContext": ctx}}, ensure_ascii=False))


def checkpoint_every():
    """서버가 알려 준 체크포인트 간격. 알려 준 적이 없으면(옛 서버) 끈다."""
    try:
        return max(0, int(json.loads(SERVER_POLICY.read_text()).get("checkpoint_turns") or 0))
    except (OSError, ValueError, TypeError, AttributeError):
        return 0


def hook_turn(inp):
    """에이전트가 응답 한 번을 끝낼 때마다 센다. N턴마다 대화록 체크포인트를 백그라운드로 올린다(#18).
    세션이 끝나기 전에도 진행 상태가 갱신되어 다른 에이전트의 /resume에 반영된다."""
    sid = inp.get("session_id") or ""
    every = checkpoint_every()
    if not sid or not every or PAUSED.exists():
        return
    m = marker_path(sid)
    if not m.exists():
        if not inp.get("transcript_path"):
            return
        cwd = inp.get("cwd") or os.getcwd()
        PENDING.mkdir(parents=True, exist_ok=True)
        m.write_text(json.dumps({"session_id": sid, "transcript_path": inp["transcript_path"], "cwd": cwd,
                                 "project": project_of(cwd), "platform": platform_name()}))
    t = turns_path(m)
    try:
        n = int(t.read_text() or 0) + 1
    except (OSError, ValueError):
        n = 1
    t.write_text(str(n))
    if n % every == 0:
        spawn_upload(m, final=False, reason="checkpoint")


def read_transcript(path):
    """대화록 끝부분을 줄 단위로 읽는다. 비공개 표시는 장비를 떠나기 전에 지운다."""
    if not path or not os.path.exists(path):
        return ""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size > MAX_TRANSCRIPT_BYTES:
            f.seek(size - MAX_TRANSCRIPT_BYTES)
            f.readline()
        text = f.read().decode("utf-8", "replace")
    return PRIVATE.sub("[비공개 처리됨]", text)


def _stamp(path):
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def _unlink_if_unchanged(m, stamp):
    """올리는 사이에 스냅샷이 새로 쓰였으면 지우지 않는다. 새 스냅샷은 다음 업로드 몫이다."""
    if _stamp(m) == stamp:
        m.unlink(missing_ok=True)


def cmd_upload(marker, final=True, reason=None):
    m = Path(marker)
    stamp = _stamp(m)
    try:
        d = json.loads(m.read_text())
    except (OSError, ValueError):
        return 0
    os.environ.setdefault("CONNTEXT_PLATFORM", d.get("platform") or "claude-code")
    if opted_out(d.get("cwd")) or PAUSED.exists():
        if final:
            _unlink_if_unchanged(m, stamp)
        return 0
    body = {"platform": d.get("platform") or "claude-code", "session_id": d["session_id"], "cwd": d.get("cwd"),
            "project": d.get("project") or project_of(d.get("cwd")),
            "final": final, "reason": reason or d.get("reason") or ""}
    if d.get("messages") is not None:
        body["messages"] = [{**x, "text": PRIVATE.sub("[비공개 처리됨]", x.get("text") or "")} for x in d["messages"]]
    else:
        body["transcript"] = read_transcript(d.get("transcript_path"))
    if not body.get("transcript") and not body.get("messages"):
        if final:
            _unlink_if_unchanged(m, stamp)
        return 0
    try:
        request("/api/hooks/session-upload", body, timeout=60.0)
        if final:
            _unlink_if_unchanged(m, stamp)
            turns_path(m).unlink(missing_ok=True)
    except Exception as e:           # 다음 세션 시작 때 다시 시도되도록 마커를 남긴다.
        log(f"upload {d.get('session_id')}: {type(e).__name__}: {e}")
        return 1
    return 0


def pid_alive(pid):
    if not pid:
        return True          # 지켜볼 프로세스가 없으면 시간 조건만 쓴다.
    if os.name == "nt":      # 윈도우의 os.kill(pid, 0)은 프로세스를 종료시키므로 쓰지 않는다.
        try:
            import ctypes
            k = ctypes.windll.kernel32
            h = k.OpenProcess(0x00100000, False, int(pid))     # SYNCHRONIZE
            if not h:
                return False
            try:
                return k.WaitForSingleObject(h, 0) == 0x00000102   # WAIT_TIMEOUT: 아직 살아 있다
            finally:
                k.CloseHandle(h)
        except Exception:
            return True
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except (PermissionError, OSError, ValueError):
        return True
    return True


def _wait_lock(marker):
    """세션마다 대기 프로세스를 하나만 둔다. 이미 기다리는 프로세스가 있으면 None.

    잠금 파일은 끝날 때 지운다. 지운 파일을 다른 프로세스가 잠그는 경쟁을 피하려고
    잠근 뒤 경로가 여전히 같은 파일을 가리키는지 확인한다."""
    try:
        import fcntl
    except ImportError:
        return True          # 윈도우: 잠금 없이 진행한다. 겹쳐 올려도 서버가 세션 id로 덮어쓴다.
    path = Path(str(marker) + ".lock")
    for _ in range(5):
        f = open(path, "a+")
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            return None
        try:
            if os.fstat(f.fileno()).st_ino == os.stat(path).st_ino:
                return (f, path)
        except OSError:
            pass
        f.close()
    return None


def _wait_unlock(lock):
    if isinstance(lock, tuple):
        f, path = lock
        try:
            path.unlink(missing_ok=True)
        finally:
            f.close()


def cmd_wait_upload(marker, after, pid=None):
    """스냅샷이 after초 동안 다시 쓰이지 않았거나, 스냅샷을 쓴 에이전트 프로세스가 끝났으면 최종 업로드한다.

    OpenCode에는 세션 종료 이벤트가 없고, 프로세스가 끝날 때 플러그인의 타이머나 dispose도 믿을 수 없다.
    그래서 에이전트와 분리된 이 프로세스가 대신 기다린다. 대화가 이어져 스냅샷이 새로 쓰이면 기다림을 연장한다."""
    m = Path(marker)
    PENDING.mkdir(parents=True, exist_ok=True)
    lock = _wait_lock(m)
    if lock is None:
        return 0             # 이미 이 세션을 기다리는 프로세스가 있다. 그쪽이 새 스냅샷을 본다.
    try:
        began = time.time()
        failures = 0
        while True:
            stamp = _stamp(m)
            watch = pid
            if stamp:
                try:
                    watch = json.loads(m.read_text()).get("pid") or pid
                except (OSError, ValueError, AttributeError):
                    pass
            alive = pid_alive(watch)
            if stamp is None:
                if not alive or time.time() - began >= after:
                    return 0
            elif not alive or time.time() - stamp[0] / 1e9 >= after:
                rc = cmd_upload(m, True)
                if rc == 0:
                    now_stamp = _stamp(m)
                    if now_stamp is None or now_stamp == stamp or not alive:
                        return 0
                    began = time.time()      # 올리는 사이 대화가 이어졌다. 새 스냅샷을 다시 기다린다.
                    continue
                if failures >= len(RETRY_SECONDS):
                    return rc                # 마커는 남는다. 다음 세션 시작 때 다시 올린다.
                time.sleep(RETRY_SECONDS[failures])
                failures += 1
                continue
            time.sleep(POLL_SECONDS)
    finally:
        _wait_unlock(lock)


def cmd_hook(event):
    try:
        raw = sys.stdin.read()
        inp = json.loads(raw) if raw.strip() else {}
    except ValueError:
        inp = {}
    try:
        if opted_out(inp.get("cwd")):
            return 0
        if event == "session-start":
            hook_session_start(inp)
        elif event == "session-end":
            hook_upload(inp, True)
        elif event == "pre-compact":
            hook_upload(inp, False)
        elif event == "turn":
            hook_turn(inp)
        elif event == "prompt":
            hook_prompt(inp)
    except Exception as e:
        log(f"hook {event}: {type(e).__name__}: {e}")
        try:
            request("/api/hooks/error", {"event": event}, timeout=2.0)
        except Exception:
            pass
    return 0


# ── MCP stdio 프록시 ────────────────────────────────────────────────
PROJECT_TOOLS = {"remember", "recall", "resume", "handoff"}


def active_session(pid):
    try:
        return json.loads((ACTIVE / f"{int(pid)}.json").read_text()).get("session_id") or None
    except (OSError, ValueError, AttributeError, TypeError):
        return None


def cmd_mcp():
    """표준 입출력 JSON-RPC를 서버의 /mcp로 중계한다. 도구 호출에 현재 저장소를 채워 넣는다."""
    project = None if opted_out(os.getcwd()) else project_of(os.getcwd())
    sess = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CONNTEXT_SESSION")
    if sess:
        os.environ["CONNTEXT_SESSION"] = sess
    for line in sys.stdin:
        if not sess:
            # OpenCode는 MCP 프로세스에 세션 id를 주지 않는다. 부모(OpenCode) 프로세스의 플러그인이 적어 둔 지금 세션을 쓴다.
            # 그래야 mark_used가 질문 단위 주입과 같은 세션으로 이어진다(리뷰 PR #24).
            cur = active_session(os.getppid())
            if cur:
                os.environ["CONNTEXT_SESSION"] = cur
            else:
                os.environ.pop("CONNTEXT_SESSION", None)
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid = msg.get("id") if isinstance(msg, dict) else None
        try:
            if isinstance(msg, dict) and msg.get("method") == "tools/call":
                p = msg.setdefault("params", {})
                a = p.setdefault("arguments", {})
                if p.get("name") in PROJECT_TOOLS and not a.get("project") and project:
                    a["project"] = project
            res = request("/mcp", msg, timeout=90.0)
        except urllib.error.HTTPError as e:
            detail = "토큰이 유효하지 않습니다. 웹의 설정 > 연결에서 새 토큰을 발급하세요." if e.code == 401 else f"HTTP {e.code}"
            res = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": f"Conntext 서버 오류: {detail}"}} if mid is not None else None
        except Exception as e:
            res = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": f"Conntext 서버에 연결할 수 없습니다: {e}"}} if mid is not None else None
        if res is not None:
            sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


# ── 설정 명령 ───────────────────────────────────────────────────────
def cmd_setup(argv):
    url = tok = None
    it = iter(argv)
    for a in it:
        if a == "--url":
            url = next(it, None)
        elif a == "--token":
            tok = next(it, None)
    if not url or not tok:
        print("사용법: conntext.py setup --url http://서버:7373 --token ctx_…", file=sys.stderr)
        return 2
    HOME.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({"url": url.rstrip("/"), "token": tok}, indent=2))
    os.chmod(CONFIG, 0o600)
    print(f"저장했습니다: {CONFIG}")
    return cmd_status()


def cmd_status():
    url, tok = config()
    if not url or not tok:
        print("설정이 없습니다. setup을 먼저 실행하세요.")
        return 1
    try:
        me = request("/api/me", timeout=5.0)
    except urllib.error.HTTPError as e:
        print(f"연결 실패: HTTP {e.code} ({'토큰이 유효하지 않습니다' if e.code == 401 else url})")
        return 1
    except Exception as e:
        print(f"연결 실패: {url} ({e})")
        return 1
    if not isinstance(me, dict) or "user" not in me:
        print(f"연결 실패: {url} 은(는) Conntext 서버가 아닙니다.")
        return 1
    teams = [s["name"] for s in me["spaces"] if s["kind"] == "team"]
    print(f"연결됨: {url}\n사용자: {me['user']['name']} <{me['user']['email']}>\n팀: {', '.join(teams) or '없음'}")
    print(f"이 폴더의 저장소: {project_of(os.getcwd())}")
    print("세션 기록: " + ("꺼짐(이 장비)" if PAUSED.exists() else "꺼짐(계정)" if me["user"]["capture_paused"] else "켜짐"))
    n = len(list(PENDING.glob("*.json"))) if PENDING.exists() else 0
    if n:
        print(f"올리지 못한 세션: {n}건 (다음 세션 시작 때 다시 시도)")
    return 0


COMMANDS = ("remember", "recall", "resume", "handoff", "forget")


def cmd_install(target):
    """OpenCode 설치: 클라이언트를 ~/.conntext/bin에 두고, 플러그인·명령어·MCP 항목을 OpenCode 설정에 넣는다."""
    if target != "opencode":
        print("사용법: conntext.py install opencode   (Claude Code는 /plugin install conntext@conntext)", file=sys.stderr)
        return 2
    import shutil
    here = Path(os.path.abspath(__file__))
    bindir = HOME / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    client = bindir / "conntext.py"
    if here != client:
        shutil.copyfile(here, client)
    os.chmod(client, 0o755)
    oc = Path(os.environ.get("OPENCODE_CONFIG_DIR") or (Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "opencode"))
    (oc / "plugins").mkdir(parents=True, exist_ok=True)
    (oc / "commands").mkdir(parents=True, exist_ok=True)
    url, _ = config()

    def fetch(rel, local):
        """저장소 체크아웃에서 실행했으면 옆 파일을, 내려받은 단일 파일이면 서버에서 가져온다."""
        if local.exists():
            return local.read_text(encoding="utf-8")
        if not url:
            raise RuntimeError("먼저 setup으로 서버 주소를 저장하세요.")
        with urllib.request.urlopen(f"{url}/client/{rel}", timeout=10) as r:
            return r.read().decode("utf-8")

    root = here.parents[2] if len(here.parents) > 2 else here.parent
    (oc / "plugins" / "conntext.js").write_text(fetch("opencode/conntext.js", root / "opencode" / "conntext.js"), encoding="utf-8")
    for name in COMMANDS:
        md = fetch(f"skills/{name}.md", root / "plugin" / "skills" / name / "SKILL.md")
        m = re.match(r"^---\n([\s\S]*?)\n---\n([\s\S]*)$", md)
        front, body = (m.group(1), m.group(2)) if m else ("", md)
        desc = re.search(r"^description:\s*(.+)$", front, re.M)
        description = desc.group(1).strip() if desc else name
        # Claude Code의 플러그인 명령 이름(/conntext:recall)을 OpenCode 명령 이름(/recall)으로 바꾼다.
        description, body = (re.sub(r"/conntext:(\w+)", r"/\1", x) for x in (description, body))
        (oc / "commands" / f"{name}.md").write_text(f"---\ndescription: {description}\n---\n{body}", encoding="utf-8")
    cfg_path = oc / "opencode.json"
    cfg = {}
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text())
        except ValueError:
            print(f"{cfg_path}를 JSON으로 읽지 못해 MCP 항목은 넣지 않았습니다. 아래 내용을 직접 추가하세요.")
            cfg = None
    entry = {"type": "local", "command": ["python3", str(client), "mcp"], "environment": {"CONNTEXT_PLATFORM": "opencode"}, "enabled": True}
    if cfg is not None:
        if cfg_path.exists():
            shutil.copyfile(cfg_path, cfg_path.with_suffix(".json.conntext-backup"))
        cfg.setdefault("$schema", "https://opencode.ai/config.json")
        cfg.setdefault("mcp", {})["conntext"] = entry
        cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    else:
        print(json.dumps({"mcp": {"conntext": entry}}, indent=2))
    print(f"OpenCode에 설치했습니다: {oc}\n명령어: " + " ".join("/" + c for c in COMMANDS) + "\nOpenCode를 다시 시작하세요.")
    return 0


def main(argv):
    if not argv:
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "hook":
        return cmd_hook(rest[0] if rest else "")
    if cmd == "mcp":
        return cmd_mcp()
    if cmd == "upload":
        if not rest:
            return 2
        opt = {k: v for k, v in zip(rest[1:], rest[2:]) if k in ("--after", "--pid", "--reason")}
        try:
            if "--after" in opt:
                return cmd_wait_upload(rest[0], float(opt["--after"]), int(opt["--pid"]) if opt.get("--pid") else None)
            return cmd_upload(rest[0], "--checkpoint" not in rest, opt.get("--reason"))
        except Exception as e:
            log(f"upload {rest[0]}: {type(e).__name__}: {e}")
            return 1
    if cmd == "setup":
        return cmd_setup(rest)
    if cmd == "status":
        return cmd_status()
    if cmd == "install":
        return cmd_install(rest[0] if rest else "")
    if cmd == "pause":
        HOME.mkdir(parents=True, exist_ok=True)
        PAUSED.write_text(time.strftime("%Y-%m-%d %H:%M:%S"))
        print("이 장비의 세션 기록을 껐습니다. 메모 저장과 조회는 그대로 됩니다.")
        return 0
    if cmd == "unpause":
        PAUSED.unlink(missing_ok=True)
        print("이 장비의 세션 기록을 켰습니다.")
        return 0
    if cmd in ("version", "--version"):
        print(VERSION)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
