"""세션 추출 지침 비교: 지금 지침과 git 기준(기본 HEAD~1)의 지침을 같은 대화록에 돌린다.

    python3 -I scripts/eval/extraction.py [--ref <git ref>] [케이스 번호 ...]

claude -p(Haiku)를 실제로 부른다. 케이스마다 두 번(옛·새) 호출하므로, 번호를 골라 돌리면 호출이 준다.
LLM 출력은 실행마다 다를 수 있다. 같은 케이스를 두 번 이상 돌려 보고 판단한다."""
import os, sys, json, re, subprocess, concurrent.futures as cf
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
os.environ["CONNTEXT_LLM"] = "claude-cli"; os.environ.setdefault("CONNTEXT_LLM_MODEL", "haiku")
from conntext import llm
args = sys.argv[1:]
ref = "HEAD~1"
if "--ref" in args:
    i = args.index("--ref"); ref = args[i + 1]; del args[i:i + 2]
old_src = subprocess.run(["git", "-C", str(ROOT), "show", f"{ref}:server/conntext/llm.py"], capture_output=True, text=True, check=True).stdout
OLD = re.search(r'SESSION_SYSTEM = """([\s\S]*?)"""', old_src).group(1)
NEW = llm.SESSION_SYSTEM
U, A, T = "사용자: ", "에이전트: ", "[도구] "
CASES = {
 "1 일회성 요청 + 근거 있는 결정": ([U+"게이트웨이 연결 실패 로그 좀 정리해 줘. 이번엔 표로 보여 줘",
     T+"Bash: grep -c 'conn fail' /var/log/gw.log", A+"| 원인 | 건수 |\n| 타임아웃 | 41 |\n| 인증 실패 | 3 |",
     U+"타임아웃이 대부분이네. 연결 타임아웃을 5초에서 10초로 늘리자. 현장 망 지연이 8초까지 나와서",
     T+"Edit: bridge/conn/config.py", A+"CONNECT_TIMEOUT을 10초로 바꿨습니다."],
     {"instruction": 0, "must": ["10초"]}),
 "2 상시 규칙 선언": ([U+"앞으로 커밋 메시지는 영어로, 명령형으로 써 줘. 매번 말하기 귀찮아",
     A+"알겠습니다.", U+"README 오타 고쳐 줘", T+"Edit: README.md", A+"고쳤습니다. 커밋: Fix typo in README"],
     {"instruction": 1}),
 "3 사람 추측 함정": ([U+"pthread mutex 우선순위 역전 생기는 거 PI mutex로 막아. 설명은 됐고 코드만",
     T+"Edit: bridge/sched/lock.c", A+"PTHREAD_PRIO_INHERIT로 바꿨습니다.", U+"ㅇㅋ 빌드", T+"Bash: make -j8", A+"빌드 성공."],
     {"instruction": 0, "no_person": True}),
 "4 확인 안 된 추측": ([U+"OTA가 가끔 98%에서 멈춰",
     A+"아마 마지막 청크의 ACK가 유실돼서일 수 있습니다. 혹은 플래시 쓰기 지연일 수도 있습니다.",
     U+"일단 로그 레벨만 올려 두고 다음에 보자", T+"Edit: ota/log.py", A+"DEBUG로 올렸습니다."],
     {"instruction": 0, "no_guess": True}),
 "5 테스트로 확인된 원인": ([U+"토큰 갱신 테스트 실패 원인 찾아줘", T+"Bash: pytest tests/auth -q",
     "[오류] FAILED tests/auth/test_refresh.py::test_near_expiry - 401 Unauthorized",
     A+"원인은 시계 오차 허용 범위(leeway)가 0초라서 만료 직전 토큰을 거부하기 때문입니다. 30초로 바꾸니 통과합니다.",
     T+"Bash: pytest tests/auth -q", A+"41 passed"],
     {"instruction": 0, "must": ["leeway"]}),
 "6 상시 호불호": ([U+"주석에 이모지 넣지 마. 진짜 싫어", A+"뺐습니다.", U+"이 함수 이름도 바꿔 줘", T+"Edit: ota/chunk.py", A+"바꿨습니다."],
     {"instruction": 1}),
 "8 확인 없이 단정한 원인": ([U+"게이트웨이가 새벽마다 클라우드 연결이 끊겨",
     A+"원인은 DNS 캐시 만료입니다. 새벽에 TTL이 끝나면서 재조회가 실패합니다.",
     U+"그래? 일단 다음에 로그 보고 확인하자", A+"네, 다음에 확인하겠습니다."],
     {"no_guess": True}),
 "9 반복된 일회성 요청": ([U+"broker 설정 파일 어디 있어? 짧게 답해", A+"/etc/mqtt/broker.conf",
     U+"ACL 파일은? 짧게", A+"/etc/mqtt/acl", U+"재시작 명령도 짧게", A+"systemctl restart mqtt-broker"],
     {"instruction": 0}),
 "10 사람 추측 함정2": ([U+"git rebase랑 merge 차이가 뭐야? 처음 써 봐서", A+"rebase는 커밋을 다시 쌓고, merge는 병합 커밋을 만듭니다.",
     U+"그럼 이 브랜치는 rebase로 해 줘", T+"Bash: git rebase main", A+"rebase했습니다."],
     {"no_person": True}),
 "7 남길 것 없음": ([U+"변수 이름 tmp를 chunk_buf로 바꿔 줘", T+"Edit: ota/chunk.py", A+"바꿨습니다.", U+"고마워"],
     {"max_total": 0}),
}
def run(label, prompt, lines):
    user = "플랫폼: claude-code\n저장소: github.com/connectivity/ble-gateway\n\n세션 기록:\n" + "\n".join(lines)
    out, tin, tout = llm._claude_cli(prompt, user, llm.SESSION_SCHEMA)
    return label, out
ONLY = set(args)
jobs = [(f"{k}|{v}", p, c[0]) for k, c in CASES.items() for v, p in (("old", OLD), ("new", NEW)) if (not ONLY or k.split()[0] in ONLY)]
res = {}
with cf.ThreadPoolExecutor(4) as ex:
    for label, out in ex.map(lambda j: run(*j), jobs):
        res[label] = out
for k, c in CASES.items():
    if ONLY and k.split()[0] not in ONLY: continue
    exp = c[1]
    for v in ("old", "new"):
        if f"{k}|{v}" not in res: continue
        o = res[f"{k}|{v}"] or {}
        cands = o.get("candidates", [])
        inst = [x["text"] for x in cands if x.get("kind") == "instruction"]
        know = [x["text"] for x in cands if x.get("kind") != "instruction"]
        print(f"[{v}] {k}: 지시 {len(inst)} / 지식 {len(know)}")
        for t in inst: print("     지시:", t)
        for t in know: print("     지식:", t)
