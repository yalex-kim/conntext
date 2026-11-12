"""데모 데이터. 전부 합성이다. 실제 파이프라인(remember, 세션 추출, 팀 승격)을 그대로 거쳐 만든다."""
import random, time
from . import access, api, db, jobs, llm, pipeline, retrieval, sessions

DAY = 86400
GW = "git@github.com:connectivity/ble-gateway.git"
OTA = "https://github.com/connectivity/ota-service.git"
SDK = "git@github.com:connectivity/conn-sdk.git"

USERS = [
    ("seoyun@conn.example", "한서윤", "operator"),
    ("dohyun@conn.example", "정도현", "user"),
    ("jimin@conn.example", "오지민", "user"),
    ("taekyung@conn.example", "윤태경", "user"),
    ("eunho@conn.example", "배은호", "auditor"),
]

# (며칠 전, 저장소, 범위, 본문)
MEMOS_DOHYUN = [
    (20, None, "global", "답변은 항상 한국어로 하고, 코드 주석은 영어로 써 줘"),
    (19, None, "global", "커밋 메시지는 conventional commits 형식으로 작성해 줘"),
    (18, GW, "project", "ble-gateway에서는 테스트를 반드시 `make test-hw-sim`으로 돌려 줘. pytest를 직접 부르면 HCI 시뮬레이터가 안 뜬다"),
    (17, GW, "project", "스테이징 배포는 화요일 오전만 가능"),
    (16, GW, "project", "스테이징 배포 승인자는 한서윤 책임"),
    (15, GW, "project", "BLE 연결 간격(connection interval)은 30ms로 고정한다. 15ms로 줄이면 게이트웨이 전류가 거의 2배가 된다"),
    (14, GW, "project", "게이트웨이 재시작 순서: mqtt-broker 먼저, 그 다음 ble-bridge. 반대로 하면 bridge가 재연결 폭주를 일으킨다"),
    (12, GW, "project", "HCI 로그는 btmon으로 뜨고 /var/log/hci 아래에 날짜별로 둔다. 7일 지나면 logrotate가 지운다"),
    (11, OTA, "project", "OTA 펌웨어 서명 키는 HSM에 있고, 서명 요청은 ota-signer 서비스로만 한다. 로컬에 키를 받지 않는다"),
    (10, OTA, "project", "OTA 청크 크기는 MTU 247 기준 244바이트. MTU 협상이 실패한 기기는 20바이트로 떨어지므로 타임아웃을 12배로 잡아야 한다"),
    (9, GW, "project", "스캔 윈도와 스캔 간격을 같게 두면(100% duty) 광고 수신율은 오르지만 Wi-Fi 공존 문제가 생긴다. 현재 값은 window 30ms / interval 60ms"),
    (7, GW, "project", "스테이징 배포는 목요일 오전만 가능하도록 변경됨. 화요일은 QA 회귀 테스트와 겹친다"),
    (6, SDK, "project", "conn-sdk의 공개 API는 semver를 지킨다. ConnectionParams 구조체 필드 추가는 minor, 이름 변경은 major"),
    (5, GW, "project", "본딩 정보는 /data/bt/bond.db에 저장된다. 공장 초기화 때 이 파일을 지우지 않으면 재페어링이 실패한다"),
    (4, None, "global", "PR 설명에는 테스트한 기기 모델과 펌웨어 버전을 꼭 적어 줘"),
    (3, GW, "project", "채널 맵 갱신 주기는 10초. AFH가 Wi-Fi 채널 1·6·11 대역을 피하도록 37개 데이터 채널 중 최소 20개를 유지한다"),
    (2, OTA, "project", "OTA 롤백은 A/B 파티션 방식. 부팅 3회 연속 실패 시 이전 슬롯으로 돌아간다"),
    (1, GW, "project", "RSSI 임계값 -85dBm 아래로 3초 유지되면 연결을 끊고 재스캔한다"),
]
MEMOS_JIMIN = [
    (15, None, "global", "설명은 결론부터 말하고 근거는 그 뒤에 붙여 줘"),
    (13, SDK, "project", "conn-sdk iOS 빌드는 Xcode 16.2 고정. 16.3에서는 CoreBluetooth 백그라운드 복원이 깨진다"),
    (9, SDK, "project", "Android 14 이상에서는 BLUETOOTH_CONNECT 권한이 없으면 getBondedDevices가 빈 목록을 돌려준다. 예외가 아니다"),
    (6, GW, "project", "게이트웨이 헬스체크 엔드포인트는 /healthz, ble-bridge는 포트 9102"),
    (3, SDK, "project", "GATT 캐시가 꼬이면 Service Changed indication을 보내야 한다. 클라이언트 재부팅으로는 안 풀리는 기기가 있다"),
]
MEMOS_TAEKYUNG = [
    (10, None, "global", "표로 정리할 수 있는 건 표로 보여 줘"),
    (8, OTA, "project", "ota-service 부하 테스트는 k6 스크립트 scripts/load/ota_burst.js를 쓴다. 동시 2000기기 기준"),
    (4, OTA, "project", "CDN 캐시 키에 펌웨어 해시가 들어가야 한다. 버전 문자열만 쓰면 재빌드 때 옛 바이너리가 내려간다"),
]

TRANSCRIPT_1 = """사용자: 토큰 갱신 테스트 2건이 실패하는데 원인 좀 찾아줘
[도구] Bash: make test-hw-sim FILTER=test_token_refresh
에이전트: 실패하는 테스트는 test_refresh_near_expiry와 test_refresh_clock_skew입니다. 두 건 모두 만료 직전 갱신에서 401이 납니다.
[도구] Read: bridge/auth/token.py
[도구] Read: tests/auth/test_token_refresh.py
에이전트: 원인은 시계 오차 허용 범위(leeway)가 0초로 설정돼 있기 때문입니다. 게이트웨이와 인증 서버의 시계가 1~2초 어긋나면 아직 유효한 토큰을 만료로 판단합니다. bridge/auth/token.py의 LEEWAY_SECONDS를 30으로 바꾸면 두 테스트가 통과합니다.
사용자: 30초로 하자. 그리고 인증 미들웨어 리팩터링도 마저 해줘
[도구] Edit: bridge/auth/token.py
[도구] Edit: bridge/auth/middleware.py
[도구] Bash: make test-hw-sim FILTER=auth
에이전트: 인증 미들웨어 리팩터링을 완료했습니다. 토큰 검증을 TokenVerifier 클래스로 분리했고 auth 테스트 41건이 모두 통과합니다.
남은 일: mqtt-broker 쪽 ACL 캐시가 옛 토큰을 5분간 들고 있어서, 갱신 직후 publish가 거부되는 문제를 아직 확인하지 못했습니다. 다음에 broker/acl_cache.py의 TTL을 확인해야 합니다.
"""
TRANSCRIPT_2 = """사용자: 스캔 수신율이 떨어졌다는데 스캔 파라미터 좀 봐줘
[도구] Read: bridge/scan/params.py
[도구] Bash: btmon -r /var/log/hci/2026-11-08.log | grep -c "LE Advertising Report"
에이전트: 스캔 윈도 30ms / 간격 60ms로 50% duty입니다. 로그를 보면 수신율 저하는 2.4GHz Wi-Fi 채널 6 트래픽이 몰리는 시간대와 겹칩니다.
에이전트: 광고 채널 38(2426MHz)이 Wi-Fi 채널 6과 겹치기 때문에, 해당 시간대에 채널 38의 수신만 크게 줄어든 것으로 확인했습니다. 스캔 파라미터 문제가 아니라 공존 문제입니다. 결정: 파라미터는 그대로 두고, AP 채널을 1이나 11로 옮기도록 설치 가이드에 추가하기로 했습니다.
사용자: 좋아 가이드 문서에 추가해줘
[도구] Edit: docs/install/wifi-coexistence.md
에이전트: docs/install/wifi-coexistence.md에 AP 채널 권장 사항을 추가했습니다. 완료했습니다.
"""
TRANSCRIPT_3 = """사용자: OTA 청크 재전송 로직에 지수 백오프 넣어줘
[도구] Read: ota/transfer/chunker.py
[도구] Edit: ota/transfer/chunker.py
[도구] Bash: pytest tests/transfer -q
에이전트: 재전송에 지수 백오프(초기 200ms, 최대 5초, 지터 ±20%)를 넣었습니다. 테스트 18건 통과.
주의: MTU 협상이 실패해 20바이트 청크로 떨어진 기기는 전체 전송이 12배 길어지므로, 백오프 상한 5초가 세션 타임아웃 90초를 넘길 수 있습니다. 다음으로 저속 기기용 타임아웃을 별도로 두는 작업이 남았습니다.
"""


def _backdate(memo_id, days):
    ts = db.now() - days * DAY - random.randint(0, 6 * 3600)
    db.ex("UPDATE memos SET created_at=?, updated_at=? WHERE id=?", ts, ts, memo_id)
    db.ex("UPDATE ingest_events SET created_at=? WHERE memo_id=?", ts, memo_id)
    return ts


def _add_memos(user, rows):
    ids = []
    for days, proj, scope, text in rows:
        r = pipeline.remember(user, text, scope=scope, project_key=api.mcp.normalize_project(proj))
        _backdate(r["memo_id"], days)
        ids.append(r["memo_id"])
    return ids


def run():
    random.seed(7)
    now = db.now()
    uid = {}
    for email, name, role in USERS:
        row = db.one("SELECT id FROM users WHERE email=?", email)
        uid[email] = row["id"] if row else db.insert("users", email=email, name=name, role=role, created_at=now - 30 * DAY)
        access.personal_space_id(uid[email])
    U = {e: db.one("SELECT * FROM users WHERE id=?", i) for e, i in uid.items()}
    seoyun, dohyun, jimin, taekyung = (U[e] for e in ("seoyun@conn.example", "dohyun@conn.example", "jimin@conn.example", "taekyung@conn.example"))

    team = db.val("SELECT id FROM spaces WHERE kind='team' AND name='Connectivity 팀'")
    if not team:
        team = db.insert("spaces", kind="team", name="Connectivity 팀", owner_id=None, created_at=now - 30 * DAY)
        for u, role in ((seoyun, "admin"), (jimin, "admin"), (dohyun, "member"), (taekyung, "member")):
            db.insert("space_members", space_id=team, user_id=u["id"], role=role)
    fw = db.val("SELECT id FROM spaces WHERE kind='team' AND name='펌웨어 파트'")
    if not fw:
        fw = db.insert("spaces", kind="team", name="펌웨어 파트", owner_id=None, created_at=now - 20 * DAY)
        for u, role in ((taekyung, "admin"), (seoyun, "member")):
            db.insert("space_members", space_id=fw, user_id=u["id"], role=role)

    d_ids = _add_memos(dohyun, MEMOS_DOHYUN)
    j_ids = _add_memos(jimin, MEMOS_JIMIN)
    t_ids = _add_memos(taekyung, MEMOS_TAEKYUNG)
    _add_memos(seoyun, [(9, None, "global", "보고용 요약은 세 줄 이내로 써 줘"),
                        (5, GW, "project", "분기 릴리스 동결은 매 분기 마지막 주 월요일부터")])

    # 세션: 훅으로 들어온 것처럼 업로드하고 추출까지 돌린다.
    gw, ota = api.mcp.normalize_project(GW), api.mcp.normalize_project(OTA)
    for i, (user, platform, ext, proj, tr, days) in enumerate([
        (dohyun, "claude-code", "demo-cc-1a2b", gw, TRANSCRIPT_2, 3),
        (dohyun, "opencode", "demo-oc-9f8e", ota, TRANSCRIPT_3, 2),
        (dohyun, "claude-code", "demo-cc-7c6d", gw, TRANSCRIPT_1, 1),
    ]):
        sessions.start(user, platform, ext, proj, "/home/dev/" + proj.split("/")[-1])
        r = sessions.upload(user, platform, ext, proj, transcript=tr, final=True, reason="exit")
        jobs.drain()
        ts = now - days * DAY + 18 * 3600 + i * 600
        db.ex("UPDATE sessions SET started_at=?, ended_at=? WHERE id=?", ts - 2400, ts, r["session_id"])
        db.ex("UPDATE memos SET created_at=?, updated_at=? WHERE origin_session_id=?", ts, ts, r["session_id"])
        db.ex("UPDATE ingest_events SET created_at=? WHERE memo_id IN (SELECT id FROM memos WHERE origin_session_id=?)", ts, r["session_id"])
        db.ex("UPDATE injections SET created_at=? WHERE session_ext_id=?", ts - 2400, ext)

    # 팀으로 올리기
    def share(user, ids, days):
        res = pipeline.promote(user, ids, team, ack=True)
        for c in res.get("created", []):
            _backdate(c["memo_id"], days)
    share(dohyun, [d_ids[6], d_ids[11], d_ids[5], d_ids[15]], 5)   # 재시작 순서, 배포 목요일, 연결 간격, 채널 맵
    share(jimin, [j_ids[1], j_ids[2], j_ids[4], j_ids[3]], 4)
    share(taekyung, [t_ids[2]], 3)
    r = pipeline.remember(seoyun, "팀 저장소의 main 브랜치에는 리뷰 승인 1건 없이 병합하지 않는다", kind="instruction")
    pipeline.promote(seoyun, [r["memo_id"]], team, ack=True)
    jobs.drain()

    # 사용 기록: 검색, 주입, 사용
    for user, q, proj in [(dohyun, "스테이징 배포 언제 가능해?", gw), (dohyun, "게이트웨이 재시작 순서", gw), (jimin, "iOS 빌드 Xcode 버전", None),
                          (taekyung, "게이트웨이 재시작할 때 주의점", gw), (taekyung, "OTA 청크 크기", ota), (jimin, "스캔 파라미터", gw),
                          (seoyun, "배포 일정", gw), (dohyun, "점심 메뉴", None)]:
        res = retrieval.recall(user, q, proj, "demo-" + str(random.randint(1000, 9999)))
        used = [x["id"] for x in res["results"][:2]]
        if used:
            retrieval.mark_used(user, used)
    for user, proj in [(dohyun, gw), (dohyun, ota), (jimin, gw), (taekyung, ota), (seoyun, gw)]:
        retrieval.build_context(user, proj, random.choice(["claude-code", "opencode"]), "demo-" + str(random.randint(1000, 9999)))

    # 클라이언트 토큰과 버전 현황
    for user, plat, ver in [(dohyun, "claude-code", "0.1.0"), (dohyun, "opencode", "0.1.0"), (jimin, "claude-code", "0.1.0"), (taekyung, "claude-code", "0.0.9")]:
        tid, _ = api.issue_token(user["id"], f"{user['name']} · {plat}")
        db.update("tokens", tid, client_platform=plat, client_version=ver, last_used_at=now - random.randint(600, 2 * DAY))

    # 지난 2주의 운영 지표(합성). 현황판이 빈 화면으로 보이지 않게 한다.
    users = [dohyun, jimin, taekyung, seoyun]
    for d in range(13, 0, -1):
        base = now - d * DAY
        weekday = time.localtime(base).tm_wday < 5
        vol = (3 if weekday else 1)
        for _ in range(random.randint(3, 7) * vol):
            u = random.choice(users)
            ts = base + random.randint(0, 9 * 3600)
            db.ex("INSERT INTO metrics(kind,name,value,user_id,ok,created_at) VALUES('latency','inject',?,?,1,?)", random.uniform(8, 60), u["id"], ts)
            db.ex("INSERT INTO injections(user_id,platform,session_ext_id,project_key,tokens,ms,created_at) VALUES(?,?,?,?,?,?,?)",
                  u["id"], random.choice(["claude-code", "claude-code", "opencode"]), f"hist-{d}-{random.randint(0, 99999)}", gw, random.randint(300, 900), random.uniform(8, 60), ts)
            db.ex("INSERT INTO metrics(kind,name,value,user_id,ok,created_at) VALUES('hook','session-start',?,?,1,?)", random.uniform(10, 70), u["id"], ts)
        for _ in range(random.randint(2, 6) * vol):
            u = random.choice(users)
            ts = base + random.randint(0, 9 * 3600)
            db.ex("INSERT INTO metrics(kind,name,value,user_id,ok,created_at) VALUES('latency','recall',?,?,1,?)", random.uniform(20, 140), u["id"], ts)
            db.ex("INSERT INTO metrics(kind,name,value,user_id,ok,created_at) VALUES('search','recall',?,?,?,?)", random.randint(0, 6), u["id"], 0 if random.random() < 0.12 else 1, ts)
            db.ex("INSERT INTO metrics(kind,name,value,user_id,ok,created_at) VALUES('cmd',?,0,?,1,?)", random.choice(["recall", "recall", "remember", "remember", "resume", "handoff", "mark_used"]), u["id"], ts)
        for stage, tin, tout in (("analyze", 900, 140), ("topic_summary", 1500, 380), ("session_extract", 6200, 420)):
            for _ in range(random.randint(1, 4) * vol):
                u = random.choice(users)
                db.ex("INSERT INTO metrics(kind,name,value,tokens_in,tokens_out,user_id,ok,created_at) VALUES('llm',?,?,?,?,?,1,?)",
                      stage, random.uniform(700, 2600), int(tin * random.uniform(0.6, 1.5)), int(tout * random.uniform(0.6, 1.4)), u["id"], base + random.randint(0, 9 * 3600))
    for name, plat in (("session-start", "claude-code"), ("session-upload", "claude-code")):
        pass
    db.ex("INSERT INTO sessions(user_id,platform,ext_id,project_key,started_at,ended_at,status) VALUES(?,?,?,?,?,?,'excluded')",
          jimin["id"], "claude-code", "demo-cc-excl", gw, now - 2 * DAY, now - 2 * DAY + 900)
    db.insert("reports", memo_id=db.val("SELECT id FROM memos WHERE space_id=? AND status='active' ORDER BY id LIMIT 1", team), space_id=team,
              reporter_id=taekyung["id"], reason="broker 버전이 올라가면서 순서 제약이 없어졌다고 들었습니다. 확인이 필요합니다.", created_at=now - 3600)
    db.audit(seoyun["id"], "policy_update", "policy", "retention")
    jobs.drain()
    print(f"[conntext] 데모 데이터 준비 완료: 사용자 {len(USERS)}명, 메모 {db.val('SELECT COUNT(*) FROM memos')}건, 주제 {db.val('SELECT COUNT(*) FROM topics')}개 (LLM: {llm.provider()})")
    print("[conntext] 로그인 예: dohyun@conn.example(개발자) · seoyun@conn.example(운영자) · eunho@conn.example(감사자)")
