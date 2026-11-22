"""절차 종류(#16) 점검: 메모 분류(ANALYZE_SYSTEM)와 세션 추출(SESSION_SYSTEM)이 절차를 제대로 가르는지 본다.

    python3 -I scripts/eval/kinds.py [analyze|session] [반복 횟수]

claude -p(Haiku)를 실제로 부른다. LLM 출력은 실행마다 다를 수 있어 반복 횟수(기본 1)만큼 돌려 맞은 비율을 본다."""
import os, sys, json, concurrent.futures as cf
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
os.environ["CONNTEXT_LLM"] = "claude-cli"; os.environ.setdefault("CONNTEXT_LLM_MODEL", "haiku")
from conntext import llm

GW = "github.com/connectivity/ble-gateway"
TOPICS = [(1, "스테이징 배포", "knowledge"), (2, "게이트웨이 재시작 순서", "procedure"), (3, "BLE 연결 간격", "knowledge")]
# (메모, 기대 종류, 고르면 안 되는 주제 id)
MEMOS = [
    ("게이트웨이 재시작 순서: mqtt-broker 먼저, 그 다음 ble-bridge. 반대로 하면 bridge가 재연결 폭주를 일으킨다", "procedure", {1, 3}),
    ("스테이징 배포 절차:\n1. `make build`\n2. `make push` (VPN 켜고)\n3. `make deploy STAGE=stg`", "procedure", {1, 2}),
    ("인증서는 certbot renew로 갱신하고 nginx를 reload한다. reload를 빼면 옛 인증서가 계속 나간다", "procedure", {1, 2, 3}),
    ("로그인 테스트가 타임아웃으로 실패하면 먼저 HCI 시뮬레이터를 재시작하고 다시 돌린다. 시뮬레이터가 30분 지나면 멈춘다", "procedure", {1, 3}),
    ("로컬에서 게이트웨이 띄우려면 docker compose up mqtt-broker, make sim-hci, make run-bridge 순서로 한다", "procedure", {1, 3}),
    ("스테이징 배포는 목요일 오전만 가능", "knowledge", {2}),
    ("스테이징 배포 승인자는 한서윤 책임", "knowledge", {2}),
    ("게이트웨이 재시작은 평균 40초 걸린다. broker가 대부분을 차지한다", "knowledge", {2}),
    ("배포가 느린 건 이미지가 2GB라서다. 베이스 이미지를 바꾸기로 했다", "knowledge", {2}),
    ("릴리스 절차가 격주에서 매주로 바뀌었다", "knowledge", set()),
    ("빌드는 npm 말고 pnpm으로 해 줘", "instruction", set()),
    ("커밋 메시지는 한국어로 써 줘", "instruction", set()),
    ("ble-gateway에서는 테스트를 반드시 `make test-hw-sim`으로 돌려 줘", "instruction", set()),
    ("로그인 리팩터링은 미들웨어 분리까지 끝났고 테스트 수정이 남음", "state", set()),
]

U, A, T, E = "사용자: ", "에이전트: ", "[도구] ", "[오류] "
SESSIONS = {
    "P1 시행착오 끝 성공": ([U + "스테이징에 배포해 줘",
        T + "Bash: make deploy STAGE=stg", E + "error: image not found: registry.conn/gw:latest",
        A + "이미지가 없어 실패했습니다. 먼저 빌드하고 푸시하겠습니다.", T + "Bash: make build", T + "Bash: make push",
        E + "push timeout: registry.conn", A + "레지스트리 접속이 안 됩니다. VPN이 꺼져 있는지 확인해 주세요.",
        U + "아 VPN 켰어", T + "Bash: make push", T + "Bash: make deploy STAGE=stg", A + "배포 완료. 헬스체크 /healthz 200 확인했습니다."],
        {"procedure": True}),
    "P2 사용자가 방법을 바로잡음": ([U + "게이트웨이 재시작해 줘", T + "Bash: systemctl restart ble-bridge",
        U + "그거 말고, broker부터 재시작하고 그 다음에 bridge 해. 반대로 하면 재연결 폭주 나", T + "Bash: systemctl restart mqtt-broker",
        T + "Bash: systemctl restart ble-bridge", T + "Bash: systemctl is-active mqtt-broker ble-bridge", A + "둘 다 active입니다. 재연결 오류 없습니다."],
        {"procedure": True}),
    "P3 성공 확인 없음": ([U + "OTA 서버 로컬에서 띄워 봐", T + "Bash: make run-ota", E + "port 8080 already in use",
        A + "포트가 사용 중입니다. 8081로 바꿔 보겠습니다.", T + "Edit: ota/config.yaml", U + "됐어 나중에 다시 하자"],
        {"procedure": False}),
    "P4 한 번만 할 작업": ([U + "ota/chunk.py에서 tmp 변수를 chunk_buf로 바꿔 줘", T + "Edit: ota/chunk.py", T + "Bash: pytest tests/ota -q", A + "12 passed"],
        {"procedure": False}),
}


def analyze_case(text):
    lines = [f"새 메모:\n{text}\n", f"작성 위치(저장소): {GW}\n", "후보 메모: 없음", "\n기존 주제:"]
    lines += [f"- id {i}: {t}" + (" (절차)" if k == "procedure" else "") for i, t, k in TOPICS]
    out, _, _ = llm._claude_cli(llm.ANALYZE_SYSTEM, "\n".join(lines), llm.ANALYZE_SCHEMA)
    return out


def session_case(lines):
    user = f"플랫폼: claude-code\n저장소: {GW}\n\n세션 기록:\n" + "\n".join(lines)
    out, _, _ = llm._claude_cli(llm.SESSION_SYSTEM, user, llm.SESSION_SCHEMA)
    return out


def main():
    args = sys.argv[1:]
    which = [a for a in args if a in ("analyze", "session")] or ["analyze", "session"]
    reps = int(next((a for a in args if a.isdigit()), "1"))
    if "analyze" in which:
        jobs = [(t, exp, bad) for t, exp, bad in MEMOS for _ in range(reps)]
        with cf.ThreadPoolExecutor(4) as ex:
            outs = list(ex.map(lambda j: analyze_case(j[0]), jobs))
        ok = 0
        for (t, exp, bad), out in zip(jobs, outs):
            if not out:
                print(f"ERR  {t[:40]}")
                continue
            good = out["kind"] == exp and (exp != "procedure" or bool(out.get("when"))) and out.get("topic_id") not in bad
            ok += good
            print(f"{'ok ' if good else 'BAD'}  {exp:>11} → {out['kind']:<11} when={out.get('when')!r:<28} topic={out.get('topic_id')}/{out.get('topic_title')}  | {t[:46]!r}")
        print(f"\n분류: {ok}/{len(jobs)}\n")
    if "session" in which:
        jobs = [(k, c) for k, c in SESSIONS.items() for _ in range(reps)]
        with cf.ThreadPoolExecutor(4) as ex:
            outs = list(ex.map(lambda j: session_case(j[1][0]), jobs))
        ok = 0
        for (k, c), out in zip(jobs, outs):
            procs = [x for x in (out or {}).get("candidates", []) if x["kind"] == "procedure"]
            good = out is not None and bool(procs) == c[1]["procedure"] and all(x.get("when") for x in procs)
            ok += good
            print(f"{'ok ' if good else 'BAD'}  {k}")
            for x in (out or {}).get("candidates", []):
                print(f"       - {x['kind']}: {x['text'][:110]!r} when={x.get('when')!r}")
        print(f"\n세션 추출: {ok}/{len(jobs)}")


if __name__ == "__main__":
    main()
