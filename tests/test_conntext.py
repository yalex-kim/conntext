"""Conntext 서버 테스트. 표준 라이브러리 unittest만 쓴다.

    python3 -m unittest discover -s tests -v

LLM 없이(규칙 경로) 돈다. 실제 HTTP 서버를 임시 포트에 띄워 API, 훅, MCP를 함께 확인한다.
"""
import json, os, sys, tempfile, threading, time, unittest, urllib.error, urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
os.environ["CONNTEXT_LLM"] = "heuristic"

from conntext import access, admin, api, db, jobs, masking, mcp, pipeline, retrieval, sessions  # noqa: E402
from conntext.access import BadRequest, Forbidden  # noqa: E402

GW = "github.com/connectivity/ble-gateway"
OTA = "github.com/connectivity/ota-service"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.configure(os.path.join(self.tmp.name, "t.db"))
        self.alice = self.user("alice@t", "앨리스")
        self.bob = self.user("bob@t", "밥")
        self.op = self.user("op@t", "운영", "operator")
        self.team = db.insert("spaces", kind="team", name="팀", created_at=db.now())
        db.insert("space_members", space_id=self.team, user_id=self.alice["id"], role="member")
        db.insert("space_members", space_id=self.team, user_id=self.bob["id"], role="admin")

    def tearDown(self):
        db.close()
        self.tmp.cleanup()

    def user(self, email, name, role="user"):
        uid = db.insert("users", email=email, name=name, role=role, created_at=db.now())
        access.personal_space_id(uid)
        return db.one("SELECT * FROM users WHERE id=?", uid)

    def memo(self, mid):
        return db.one("SELECT * FROM memos WHERE id=?", mid)


class TestMasking(Base):
    def test_secrets_are_masked_before_storage(self):
        r = pipeline.remember(self.alice, "배포 서버 접속은 api_key = sk-live-abcdef1234567890 로 한다. 담당 010-1234-5678")
        body = self.memo(r["memo_id"])["body"]
        self.assertNotIn("sk-live-abcdef1234567890", body)
        self.assertNotIn("010-1234-5678", body)
        self.assertIn("api_key", body)
        self.assertEqual(r["masked"], 2)
        self.assertIn("마스킹", r["message"])

    def test_private_tag_is_removed(self):
        text, n = masking.mask("공개 내용 <private>내부 사정</private> 끝")
        self.assertNotIn("내부 사정", text)
        self.assertEqual(n, 1)

    def test_only_private_content_is_rejected(self):
        with self.assertRaises(BadRequest):
            pipeline.remember(self.alice, "   ")

    def test_fts_never_sees_secret(self):
        pipeline.remember(self.alice, "토큰은 token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 이다")
        self.assertEqual(db.q("SELECT rowid FROM memos_fts WHERE memos_fts MATCH '\"ghp_abcdef\"'"), [])


class TestIngest(Base):
    def test_classification(self):
        a = pipeline.remember(self.alice, "답변은 항상 한국어로 해 줘")
        b = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        c = pipeline.remember(self.alice, "B 건은 김 과장 회신 대기 중", project_key=GW)
        self.assertEqual(a["kind"], "instruction")
        self.assertEqual(a["scope"], "global")
        self.assertEqual(b["kind"], "knowledge")
        self.assertEqual(b["scope"], "project")
        self.assertEqual(b["project_key"], GW)
        self.assertEqual(c["kind"], "state")
        self.assertEqual(len(b["topics"]), 1)
        self.assertEqual(a["topics"], [])

    def test_update_supersedes_and_keeps_original(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        b = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능하도록 변경됨", project_key=GW)
        self.assertEqual(b["relation"], "update")
        old = self.memo(a["memo_id"])
        self.assertEqual(old["status"], "superseded")
        self.assertEqual(old["superseded_by"], b["memo_id"])
        self.assertEqual(old["body"], "스테이징 배포는 화요일 오전만 가능")       # 원문은 그대로
        self.assertEqual([t["id"] for t in b["topics"]], [t["id"] for t in a["topics"]])
        hits = retrieval.search([access.personal_space_id(self.alice["id"])], "스테이징 배포", GW)
        self.assertEqual([h["id"] for h in hits], [b["memo_id"]])                 # 대체된 메모는 검색에서 빠진다

    def test_undo_restores_superseded(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        b = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능하도록 변경됨", project_key=GW)
        pipeline.undo(self.alice, b["event_id"])
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")
        self.assertEqual(self.memo(b["memo_id"])["status"], "deleted")
        with self.assertRaises(BadRequest):
            pipeline.undo(self.alice, b["event_id"])

    def test_duplicate_is_merged_not_added(self):
        a = pipeline.remember(self.alice, "게이트웨이 재시작은 broker를 먼저 올리고 bridge를 올린다", project_key=GW)
        b = pipeline.remember(self.alice, "게이트웨이 재시작은 broker를 먼저 올리고 bridge를 올린다.", project_key=GW)
        self.assertEqual(b["relation"], "duplicate")
        self.assertEqual(self.memo(b["memo_id"])["status"], "duplicate")
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")

    def test_unrelated_memos_get_separate_topics(self):
        a = pipeline.remember(self.alice, "OTA 서명 키는 HSM에 보관한다", project_key=OTA)
        b = pipeline.remember(self.alice, "HCI 로그는 btmon으로 뜬다", project_key=GW)
        self.assertNotEqual(a["topics"][0]["id"], b["topics"][0]["id"])

    def test_undo_removes_topic_it_created(self):
        a = pipeline.remember(self.alice, "OTA 서명 키는 HSM에 보관한다")
        tid = a["topics"][0]["id"]
        pipeline.undo(self.alice, a["event_id"])
        self.assertIsNone(db.one("SELECT id FROM topics WHERE id=?", tid))

    def test_forget_revives_what_it_replaced(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        b = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능하도록 변경됨", project_key=GW)
        f = pipeline.forget(self.alice, b["memo_id"])
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")
        pipeline.undo(self.alice, f["event_id"])
        self.assertEqual(self.memo(b["memo_id"])["status"], "active")
        self.assertEqual(self.memo(a["memo_id"])["status"], "superseded")

    def test_topic_summary_cites_memos_and_separates_history(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        b = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능하도록 변경됨", project_key=GW)
        jobs.drain()
        s = db.one("SELECT summary, dirty FROM topics WHERE id=?", a["topics"][0]["id"])
        self.assertEqual(s["dirty"], 0)
        self.assertIn(f"[m:{b['memo_id']}]", s["summary"])
        self.assertIn("이전", s["summary"])
        self.assertLess(s["summary"].index(f"[m:{b['memo_id']}]"), s["summary"].index(f"[m:{a['memo_id']}]"))

    def test_edit_creates_new_version(self):
        from conntext.api import memo_edit, Req
        a = pipeline.remember(self.alice, "헬스체크 포트는 9102")
        r = memo_edit(Req(self.alice, {}, {"text": "헬스체크 포트는 9103"}, {}), str(a["memo_id"]))
        self.assertEqual(self.memo(a["memo_id"])["status"], "superseded")
        self.assertEqual(self.memo(a["memo_id"])["body"], "헬스체크 포트는 9102")
        self.assertEqual(self.memo(r["memo_id"])["body"], "헬스체크 포트는 9103")

    def test_import_splits_into_memos(self):
        r = pipeline.import_text(self.alice, "# 규칙\n- 커밋 메시지는 영어로 써 줘\n- 테스트는 make test로 돌린다\n\n짧음\n")
        self.assertEqual(r["count"], 2)


class TestKindChange(Base):
    def topics_of(self, mid):
        return [r["topic_id"] for r in db.q("SELECT topic_id FROM memo_topics WHERE memo_id=?", mid)]

    def test_knowledge_to_instruction_and_back(self):
        a = pipeline.remember(self.alice, "게이트웨이 재시작 순서: broker 먼저, 그 다음 bridge", project_key=GW)
        mid, tid = a["memo_id"], a["topics"][0]["id"]
        jobs.drain()
        r = pipeline.set_kind(self.alice, mid, "instruction")
        self.assertEqual(self.memo(mid)["kind"], "instruction")
        self.assertEqual(self.topics_of(mid), [])
        self.assertEqual(r["topics"], [])
        self.assertIn("지식 → 지시·선호", r["message"])
        self.assertEqual(db.val("SELECT dirty FROM topics WHERE id=?", tid), 1)   # 빠진 주제는 다시 생성 대상
        self.assertEqual(self.memo(mid)["body"], "게이트웨이 재시작 순서: broker 먼저, 그 다음 bridge")
        b = pipeline.set_kind(self.alice, mid, "knowledge")
        self.assertEqual(self.memo(mid)["kind"], "knowledge")
        self.assertEqual(len(self.topics_of(mid)), 1)
        self.assertEqual(len(b["topics"]), 1)

    def test_instruction_to_knowledge_joins_topic_and_undo_restores(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능", project_key=GW, kind="instruction")
        mid = a["memo_id"]
        self.assertEqual(self.topics_of(mid), [])
        r = pipeline.set_kind(self.alice, mid, "knowledge")
        self.assertEqual(len(self.topics_of(mid)), 1)
        created = self.topics_of(mid)[0]
        pipeline.undo(self.alice, r["event_id"])
        self.assertEqual(self.memo(mid)["kind"], "instruction")
        self.assertEqual(self.topics_of(mid), [])
        self.assertIsNone(db.one("SELECT 1 FROM topics WHERE id=?", created))      # 이 변경이 만든 빈 주제는 지운다
        with self.assertRaises(BadRequest):
            pipeline.undo(self.alice, r["event_id"])

    def test_state_gets_expiry_and_loses_it(self):
        a = pipeline.remember(self.alice, "OTA 청크 크기는 244바이트", project_key=OTA)
        mid, tid = a["memo_id"], a["topics"][0]["id"]
        self.assertIsNone(self.memo(mid)["expires_at"])
        r = pipeline.set_kind(self.alice, mid, "state")
        m = self.memo(mid)
        self.assertEqual(m["kind"], "state")
        self.assertGreater(m["expires_at"], db.now())
        self.assertEqual(m["trust"], "temp")
        self.assertEqual(self.topics_of(mid), [])
        jobs.drain()                                                                 # 비게 된 주제는 워커가 정리한다
        self.assertIsNone(db.one("SELECT 1 FROM topics WHERE id=?", tid))
        pipeline.undo(self.alice, r["event_id"])                                     # 되돌리면 주제 소속도 돌아온다
        m = self.memo(mid)
        self.assertEqual((m["kind"], m["expires_at"], m["trust"]), ("knowledge", None, "high"))
        self.assertEqual(len(self.topics_of(mid)), 1)
        pipeline.set_kind(self.alice, mid, "state")
        pipeline.set_kind(self.alice, mid, "knowledge")
        m = self.memo(mid)
        self.assertEqual((m["kind"], m["expires_at"], m["trust"]), ("knowledge", None, "high"))

    def test_undo_older_change_after_newer_is_refused(self):
        mid = pipeline.remember(self.alice, "답변은 한국어로 해 줘")["memo_id"]
        r1 = pipeline.set_kind(self.alice, mid, "knowledge")
        pipeline.set_kind(self.alice, mid, "state")
        with self.assertRaises(BadRequest):
            pipeline.undo(self.alice, r1["event_id"])

    def test_permissions_and_validation(self):
        mid = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능", project_key=GW)["memo_id"]
        with self.assertRaises((Forbidden, access.NotFound)):
            pipeline.set_kind(self.bob, mid, "instruction")
        self.assertEqual(self.memo(mid)["kind"], "knowledge")
        with self.assertRaises(BadRequest):
            pipeline.set_kind(self.alice, mid, "knowledge")
        with self.assertRaises(BadRequest):
            pipeline.set_kind(self.alice, mid, "wiki")

    def test_session_candidate_can_change_kind(self):
        c = pipeline.remember(self.alice, "테스트는 make test-hw-sim으로 돌린다", source="session", trust="low", project_key=GW)
        pipeline.set_kind(self.alice, c["memo_id"], "instruction")
        m = self.memo(c["memo_id"])
        self.assertEqual((m["kind"], m["trust"]), ("instruction", "low"))


class TestLLMCandidates(Base):
    def test_llm_path_gets_same_repo_memos_without_similarity_cut(self):
        ids = [pipeline.remember(self.alice, t, project_key=GW)["memo_id"] for t in (
            "BLE 연결 간격(connection interval)은 30ms로 고정한다", "HCI 로그는 btmon으로 뜬다",
            "스테이징 배포는 목요일 오전만 가능", "본딩 정보는 /data/bt/bond.db에 저장된다",
            "채널 맵 갱신 주기는 10초", "RSSI -85dBm 아래로 3초면 재스캔", "헬스체크는 /healthz",
            "재시작은 broker 먼저", "스캔 window 30ms / interval 60ms", "OTA는 A/B 파티션")]
        other = pipeline.remember(self.alice, "슬레이브 레이턴시는 4", project_key=OTA)["memo_id"]
        new = pipeline.remember(self.alice, "연결 간격 30ms에서 슬레이브 레이턴시는 4로 둔다", project_key=GW)
        memo = self.memo(new["memo_id"])
        found = retrieval.search([memo["space_id"]], memo["body"], GW, limit=5, exclude_ids=(memo["id"],), min_score=0.0,
                                 statuses=("active",), kinds=("knowledge", "instruction"))
        cands = pipeline.llm_candidates(found, memo, memo["space_id"])
        cid = [c["id"] for c in cands]
        self.assertLessEqual(len(cid), 8)
        self.assertEqual(len(cid), len(set(cid)))
        self.assertNotIn(memo["id"], cid)
        self.assertEqual(cid[:len(found)], [c["id"] for c in found])               # 검색 상위 후보가 먼저, 컷 없이
        self.assertIn(ids[-1], cid)                                                  # 같은 저장소의 최근 메모가 더해진다
        self.assertTrue(set(cid) - {c["id"] for c in found} <= set(ids))            # 더해지는 건 같은 저장소 메모뿐


class TestClaudeCliTokens(unittest.TestCase):
    def test_cache_reads_are_not_counted(self):
        from unittest import mock
        from conntext import llm
        out = {"result": '{"ok": true}', "usage": {"input_tokens": 2, "cache_creation_input_tokens": 2563,
                                                   "cache_read_input_tokens": 337605, "output_tokens": 40}}
        fake = mock.Mock(returncode=0, stdout=json.dumps(out), stderr="")
        with mock.patch("subprocess.run", return_value=fake):
            parsed, tin, tout = llm._claude_cli("sys", "user", {"type": "object"})
        self.assertEqual((parsed, tin, tout), ({"ok": True}, 2565, 40))


class TestAdminFixes(Base):
    def test_broken_rule_is_skipped_on_real_ingest(self):
        db.set_policy("masking_rules", [{"name": "깨진 규칙", "pattern": "([a-z"}, {"name": "사번", "pattern": r"EMP-\d{6}"}])
        r = pipeline.remember(self.alice, "담당 EMP-123456 에게 문의")
        self.assertNotIn("EMP-123456", self.memo(r["memo_id"])["body"])
        self.assertEqual(r["masked"], 1)

    def test_denials_are_audited(self):
        with self.assertRaises(Forbidden):
            access.require_read(self.op, self.team)
        with self.assertRaises(Forbidden):
            access.require_team_admin(self.alice, self.team)
        with self.assertRaises(Forbidden):
            access.require_role(self.alice, "operator", path="GET /api/admin/users")
        rows = {db.js(r["detail"])["denied"]: r for r in db.q("SELECT * FROM audit_log WHERE action='access_denied'")}
        self.assertEqual(set(rows), {"space_read", "space_admin", "role"})
        self.assertEqual((rows["space_read"]["actor_id"], rows["space_read"]["target_id"]), (self.op["id"], str(self.team)))
        self.assertEqual((rows["space_admin"]["actor_id"], rows["space_admin"]["space_id"]), (self.alice["id"], self.team))
        d = db.js(rows["role"]["detail"])
        self.assertEqual((rows["role"]["actor_id"], d["required"], d["path"]), (self.alice["id"], ["operator"], "GET /api/admin/users"))
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind='authz'"), 3)

    def with_tz(self, tz):
        old = os.environ.get("TZ")
        os.environ["TZ"] = tz
        time.tzset()

        def restore():
            if old is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old
            time.tzset()
        self.addCleanup(restore)

    def test_daily_series_uses_local_dates(self):
        self.with_tz("Asia/Seoul")
        days = admin._days(14)
        today0 = days[-1]
        self.assertEqual(time.strftime("%H:%M", time.localtime(today0)), "00:00")
        # 한국 00:30은 UTC로는 전날 15:30이다. UTC 경계라면 어제로 들어간다.
        db.insert("metrics", kind="llm", name="analyze", value=1, tokens_in=700, tokens_out=0, ok=1, created_at=today0 + 1800)
        db.insert("metrics", kind="llm", name="analyze", value=1, tokens_in=50, tokens_out=0, ok=1, created_at=today0 - 1800)
        daily = admin.overview()["cost"]["daily"]
        self.assertEqual(daily[-1], {"day": today0, "value": 700})
        self.assertEqual(daily[-2]["value"], 50)

    def test_days_are_local_midnights_across_dst(self):
        self.with_tz("America/New_York")
        days = admin._days(400)                                                      # 일광 절약 시간 전환을 두 번 넘는다
        self.assertTrue(all(time.strftime("%H:%M", time.localtime(d)) == "00:00" for d in days))
        dates = [time.strftime("%Y-%m-%d", time.localtime(d)) for d in days]
        self.assertEqual(len(set(dates)), 400)
        self.assertEqual({days[i + 1] - days[i] for i in range(399)}, {82800, 86400, 90000})

    def test_create_user_validation(self):
        for email, name in (("not-an-email", "새 사람"), ("a b@corp.example", "새 사람"), ("new@corp.example", "  "), ("", "새 사람")):
            with self.assertRaises(BadRequest):
                admin.create_user(self.op, email, name)
        uid = admin.create_user(self.op, "  new@corp.example ", " 새 사람 ")
        self.assertEqual(db.one("SELECT email, name FROM users WHERE id=?", uid), {"email": "new@corp.example", "name": "새 사람"})
        with self.assertRaises(BadRequest):
            admin.create_user(self.op, "NEW@corp.example", "중복")

    def test_offboard_preview_counts(self):
        a = pipeline.remember(self.alice, "개인 메모 하나")
        pipeline.remember(self.alice, "개인 메모 둘")
        pipeline.forget(self.alice, a["memo_id"])                                   # 삭제 상태도 실제로 지워질 대상이다
        t = pipeline.remember(self.alice, "팀에 올릴 메모", project_key=GW)
        pipeline.promote(self.alice, [t["memo_id"]], self.team)
        u = next(x for x in admin.users() if x["id"] == self.alice["id"])
        self.assertEqual((u["team_memos_authored"], u["personal_memos_to_delete"]), (1, 3))
        self.assertEqual(u["memos"], 2)
        r = admin.offboard(self.op, self.alice["id"], "delete", self.bob["id"])
        self.assertEqual((r["reassigned_team_memos"], r["deleted_memos"]), (1, 3))  # 미리보기와 실제 처리가 같다

    def test_reports_open_in_overview_and_alerts(self):
        o = admin.overview()
        self.assertEqual(o["reports_open"], 0)
        self.assertNotIn("reports_open", [a["key"] for a in o["alerts"]])
        db.insert("reports", space_id=self.team, reporter_id=self.bob["id"], reason="틀린 내용", created_at=db.now())
        db.insert("reports", space_id=self.team, reporter_id=self.bob["id"], reason="해결됨", status="resolved", created_at=db.now())
        o = admin.overview()
        self.assertEqual(o["reports_open"], 1)
        al = next(a for a in o["alerts"] if a["key"] == "reports_open")
        self.assertEqual(al["level"], "info")

    def test_budget_on_exceed_is_retired(self):
        self.assertNotIn("on_exceed", db.policy("budget"))
        db.set_policy("budget", {"daily_tokens_per_user": 1000, "on_exceed": "defer"})   # 예전에 저장된 값
        self.assertEqual(db.policy("budget"), {"daily_tokens_per_user": 1000})


class TestScopeAndInjection(Base):
    def test_project_memo_does_not_leak_into_other_project(self):
        pipeline.remember(self.alice, "ble-gateway 테스트는 항상 make test-hw-sim으로 돌려 줘", project_key=GW)
        pipeline.remember(self.alice, "답변은 항상 한국어로 해 줘")
        gw = retrieval.build_context(self.alice, GW, log=False)["text"]
        ota = retrieval.build_context(self.alice, OTA, log=False)["text"]
        self.assertIn("make test-hw-sim", gw)
        self.assertNotIn("make test-hw-sim", ota)
        self.assertIn("한국어", ota)

    def test_candidates_are_never_injected_but_are_recallable(self):
        pipeline.remember(self.alice, "스캔 윈도는 30ms로 둔다", project_key=GW)
        c = pipeline.remember(self.alice, "광고 채널 38은 Wi-Fi 채널 6과 겹쳐 수신이 줄어든다", project_key=GW, source="session", trust="low")
        ctx = retrieval.build_context(self.alice, GW, log=False)
        self.assertNotIn("광고 채널 38", ctx["text"])
        self.assertNotIn(c["memo_id"], ctx["memo_ids"])
        res = retrieval.recall(self.alice, "광고 채널 38 Wi-Fi", GW)
        hit = [r for r in res["results"] if r["id"] == c["memo_id"]]
        self.assertEqual(hit[0]["tier"], "candidate")
        self.assertIn("미확인", mcp.fmt_recall(res))

    def test_candidate_promoted_after_enough_use(self):
        c = pipeline.remember(self.alice, "광고 채널 38은 Wi-Fi 채널 6과 겹친다", source="session", trust="low")
        retrieval.mark_used(self.alice, [c["memo_id"]])
        self.assertEqual(self.memo(c["memo_id"])["trust"], "low")
        r = retrieval.mark_used(self.alice, [c["memo_id"]])
        self.assertEqual(r["promoted"], [c["memo_id"]])
        self.assertEqual(self.memo(c["memo_id"])["trust"], "high")

    def test_candidate_cannot_supersede_human_memo(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        b = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능하도록 변경됨", project_key=GW, source="session", trust="low")
        self.assertNotEqual(b["relation"], "update")
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")

    def test_injection_respects_token_budget(self):
        for i in range(30):
            pipeline.remember(self.alice, f"규칙 {i}: 로그 수준 {i}번 채널은 항상 이 설명대로 길게 풀어서 적어 줘 " + "가" * 60, kind="instruction", do_analyze=False)
        db.set_policy("injection", {"token_budget": 400, "max_instructions": 30, "max_topics": 10})
        ctx = retrieval.build_context(self.alice, None, log=False)
        self.assertLessEqual(ctx["tokens"], 400)
        self.assertGreater(ctx["sections"][0]["dropped"], 0)

    def test_empty_space_injects_nothing(self):
        self.assertEqual(retrieval.build_context(self.bob, GW, log=False)["text"], "")

    def test_expired_state_is_not_resumed(self):
        r = sessions.save_handoff(self.alice, GW, "남은 일: ACL 캐시 TTL 확인")
        self.assertIn("ACL", retrieval.resume(self.alice, GW)["state"]["body"])
        db.ex("UPDATE memos SET expires_at=? WHERE id=?", db.now() - 10, r["memo_id"])
        self.assertIsNone(retrieval.resume(self.alice, GW)["state"])
        sessions.maintenance()
        self.assertEqual(self.memo(r["memo_id"])["status"], "expired")

    def test_new_handoff_replaces_previous_for_same_project_only(self):
        a = sessions.save_handoff(self.alice, GW, "남은 일: 첫 번째")
        o = sessions.save_handoff(self.alice, OTA, "남은 일: 다른 저장소")
        b = sessions.save_handoff(self.alice, GW, "남은 일: 두 번째")
        self.assertEqual(self.memo(a["memo_id"])["status"], "superseded")
        self.assertEqual(self.memo(o["memo_id"])["status"], "active")
        self.assertIn("두 번째", retrieval.resume(self.alice, GW)["state"]["body"])


class TestSearchScope(Base):
    """키워드(FTS) 가점은 검색 대상 공간 안에서 계산한다(이슈 #1)."""

    def hit_of(self, user, mid, query="watchdog 타이머"):
        hits = [h for h in retrieval.search(access.space_ids(user["id"]), query) if h["id"] == mid]
        self.assertEqual(len(hits), 1)
        return hits[0]

    def test_keyword_boost_ignores_memos_in_other_spaces(self):
        # 밥의 개인 공간 메모가 FTS 상위 40건을 다 차지해도, 앨리스의 메모는 키워드 가점을 받아야 한다.
        for i in range(45):
            pipeline.remember(self.bob, f"watchdog 타이머 설정 메모 {i} watchdog watchdog", do_analyze=False)
        mid = pipeline.remember(self.alice, "게이트웨이 재부팅 원인은 watchdog 타이머 만료였다", do_analyze=False)["memo_id"]
        hit = self.hit_of(self.alice, mid)
        self.assertAlmostEqual(hit["score"], round(0.7 * hit["cos"] + 0.3, 4), places=3)

    def test_keyword_boost_ignores_deleted_memos(self):
        # 삭제된 메모가 40건 자리를 차지해도 살아있는 메모는 키워드 가점을 받아야 한다.
        dead = [pipeline.remember(self.alice, f"watchdog 타이머 정리 기록 {i} watchdog watchdog", do_analyze=False)["memo_id"]
                for i in range(45)]
        db.ex(f"UPDATE memos SET status='deleted' WHERE id IN ({','.join('?' * len(dead))})", *dead)
        mid = pipeline.remember(self.alice, "게이트웨이 재부팅 원인은 watchdog 타이머 만료였다", do_analyze=False)["memo_id"]
        hit = self.hit_of(self.alice, mid)
        self.assertAlmostEqual(hit["score"], round(0.7 * hit["cos"] + 0.3, 4), places=3)


    def test_keyword_boost_ignores_other_kinds_when_filtered(self):
        # 종류를 골라 찾을 때(/resume의 관련 메모, 관계 판정 후보), 다른 종류의 메모가 40건 자리를 차지해도
        # 고른 종류의 메모는 키워드 가점을 받아야 한다.
        for i in range(45):
            pipeline.remember(self.alice, f"watchdog 타이머 확인 중 {i} watchdog watchdog", kind="state", do_analyze=False)
        mid = pipeline.remember(self.alice, "게이트웨이 재부팅 원인은 watchdog 타이머 만료였다", kind="knowledge", do_analyze=False)["memo_id"]
        hits = [h for h in retrieval.search(access.space_ids(self.alice["id"]), "watchdog 타이머", kinds=("knowledge", "instruction"))
                if h["id"] == mid]
        self.assertEqual(len(hits), 1)
        self.assertAlmostEqual(hits[0]["score"], round(0.7 * hits[0]["cos"] + 0.3, 4), places=3)

    def test_broken_fts_query_is_recorded(self):
        # 키워드 질의가 실패해도 검색은 계속되고, 실패는 추적 기록에 남는다.
        mid = pipeline.remember(self.alice, "게이트웨이 재부팅 원인은 watchdog 타이머 만료였다", do_analyze=False)["memo_id"]
        db.ex("DROP TABLE memos_fts")
        hits = retrieval.search(access.space_ids(self.alice["id"]), "watchdog 타이머")
        self.assertEqual([h["id"] for h in hits], [mid])
        self.assertTrue(db.q("SELECT 1 FROM trace WHERE stage='fts_error'"))


class TestSessions(Base):
    JSONL = "\n".join(json.dumps(x, ensure_ascii=False) for x in [
        {"type": "user", "message": {"role": "user", "content": "토큰 갱신 테스트 실패 원인 찾아줘"}},
        {"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "확인해 보겠습니다."},
            {"type": "tool_use", "name": "Bash", "input": {"command": "make test FILTER=token"}}]}},
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "SECRET FILE CONTENT password=hunter2hunter2"}]}},
        {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text":
            "원인은 시계 오차 허용 범위가 0초로 설정돼 있기 때문입니다. LEEWAY를 30초로 바꿨습니다.\n남은 일: broker ACL 캐시 TTL 확인이 아직 남았습니다."}]}},
    ])

    def test_condense_drops_tool_results(self):
        text = sessions.condense(self.JSONL)
        self.assertIn("사용자: 토큰 갱신", text)
        self.assertIn("[도구] Bash: make test", text)
        self.assertNotIn("hunter2", text)

    def test_upload_extracts_handoff_and_low_trust_candidates(self):
        sessions.start(self.alice, "claude-code", "s1", GW)
        r = sessions.upload(self.alice, "claude-code", "s1", GW, transcript=self.JSONL)
        self.assertEqual(r["status"], "uploaded")
        jobs.drain()
        s = db.one("SELECT * FROM sessions WHERE id=?", r["session_id"])
        self.assertEqual(s["status"], "extracted")
        st = retrieval.resume(self.alice, GW)["state"]
        self.assertIn("ACL 캐시", st["body"])
        cands = db.q("SELECT * FROM memos WHERE origin_session_id=? AND kind!='state'", r["session_id"])
        self.assertTrue(cands)
        self.assertTrue(all(c["trust"] == "low" and c["source"] == "session" for c in cands))

    def test_paused_user_stores_nothing(self):
        db.update("users", self.alice["id"], capture_paused=1)
        alice = db.one("SELECT * FROM users WHERE id=?", self.alice["id"])
        r = sessions.upload(alice, "claude-code", "s2", GW, transcript=self.JSONL)
        self.assertEqual(r["status"], "excluded")
        self.assertIsNone(db.one("SELECT transcript FROM sessions WHERE id=?", r["session_id"])["transcript"])
        self.assertEqual(jobs.drain(), 0)

    def test_excluded_project_policy(self):
        db.set_policy("capture", {"platforms": ["claude-code"], "excluded_projects": ["ota-service"], "max_transcript_chars": 400000})
        self.assertEqual(sessions.upload(self.alice, "claude-code", "s3", OTA, transcript=self.JSONL)["status"], "excluded")
        self.assertEqual(sessions.upload(self.alice, "opencode", "s4", GW, transcript=self.JSONL)["status"], "excluded")
        self.assertEqual(sessions.upload(self.alice, "claude-code", "s5", GW, transcript=self.JSONL)["status"], "uploaded")

    def test_unused_candidates_expire(self):
        c = pipeline.remember(self.alice, "쓰이지 않을 후보 내용입니다", source="session", trust="low")
        db.ex("UPDATE memos SET created_at=? WHERE id=?", db.now() - 40 * 86400, c["memo_id"])
        sessions.maintenance()
        self.assertEqual(self.memo(c["memo_id"])["status"], "expired")


class TestTeam(Base):
    def test_promote_is_a_copy_with_provenance(self):
        a = pipeline.remember(self.alice, "게이트웨이 재시작 순서: broker 먼저, 그 다음 bridge", project_key=GW)
        r = pipeline.promote(self.alice, [a["memo_id"]], self.team)
        self.assertFalse(r["dry_run"])
        copy = self.memo(r["created"][0]["memo_id"])
        self.assertEqual(copy["space_id"], self.team)
        self.assertEqual(copy["origin_memo_id"], a["memo_id"])
        self.assertEqual(copy["author_id"], self.alice["id"])
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")           # 원본은 남는다
        res = retrieval.recall(self.bob, "게이트웨이 재시작 순서", GW)
        self.assertEqual(res["results"][0]["tier"], "team")
        self.assertEqual(res["results"][0]["author"], "앨리스")
        self.assertTrue(db.q("SELECT 1 FROM audit_log WHERE action='promote'"))

    def test_unconfirmed_candidate_is_blocked(self):
        c = pipeline.remember(self.alice, "확인되지 않은 세션 추출 내용입니다", source="session", trust="low")
        r = pipeline.promote(self.alice, [c["memo_id"]], self.team)
        self.assertEqual(r.get("created", []), [])
        self.assertEqual(len(r["blocked"]), 1)

    def test_restricted_source_needs_acknowledgement(self):
        a = pipeline.remember(self.alice, "제한 문서에서 본 인증 서버 구성 요약", source_acl=["보안팀 전용"])
        r = pipeline.promote(self.alice, [a["memo_id"]], self.team)
        self.assertTrue(r["dry_run"])
        self.assertTrue(r["need_ack"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM memos WHERE space_id=?", self.team), 0)
        r = pipeline.promote(self.alice, [a["memo_id"]], self.team, ack=True)
        self.assertEqual(len(r["created"]), 1)
        self.assertEqual(db.js(db.one("SELECT detail FROM audit_log WHERE action='promote'")["detail"])["acknowledged"], True)

    def test_cannot_promote_someone_elses_memo(self):
        a = pipeline.remember(self.alice, "앨리스의 개인 메모입니다")
        with self.assertRaises(Forbidden):
            pipeline.promote(self.bob, [a["memo_id"]], self.team)

    def test_non_member_cannot_read_team_or_personal(self):
        carol = self.user("carol@t", "캐럴")
        a = pipeline.remember(self.alice, "게이트웨이 재시작 순서: broker 먼저", project_key=GW)
        pipeline.promote(self.alice, [a["memo_id"]], self.team)
        self.assertEqual(retrieval.recall(carol, "게이트웨이 재시작 순서", GW)["results"], [])
        with self.assertRaises(Forbidden):
            access.get_memo(carol, a["memo_id"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind='authz'"), 1)

    def test_team_member_cannot_delete_others_team_memo_but_admin_can(self):
        a = pipeline.remember(self.alice, "게이트웨이 재시작 순서: broker 먼저", project_key=GW)
        tm = pipeline.promote(self.alice, [a["memo_id"]], self.team)["created"][0]["memo_id"]
        carol = self.user("carol@t", "캐럴")
        db.insert("space_members", space_id=self.team, user_id=carol["id"], role="member")
        with self.assertRaises(Forbidden):
            pipeline.forget(carol, tm)
        pipeline.forget(self.bob, tm)            # 밥은 팀 관리자
        self.assertEqual(self.memo(tm)["status"], "deleted")


class TestAdmin(Base):
    def test_break_glass_requires_reason_audits_and_notifies(self):
        pipeline.remember(self.alice, "앨리스의 개인 메모입니다")
        with self.assertRaises(BadRequest):
            admin.break_glass(self.op, self.alice["id"], "짧음")
        r = admin.break_glass(self.op, self.alice["id"], "장애 분석: 주입 오류 재현을 위해 열람")
        self.assertEqual(len(r["memos"]), 1)
        self.assertTrue(db.q("SELECT 1 FROM audit_log WHERE action='break_glass'"))
        n = db.q("SELECT body FROM notifications WHERE user_id=?", self.alice["id"])
        self.assertEqual(len(n), 1)
        self.assertIn("운영", n[0]["body"])

    def test_trace_has_no_content(self):
        a = pipeline.remember(self.alice, "아주특이한본문문자열 ZXQ")
        t = admin.trace_memo(a["memo_id"])
        self.assertNotIn("ZXQ", json.dumps(t, ensure_ascii=False))
        self.assertTrue(any(s["stage"] == "analyze" for s in t["stages"]))

    def test_overview_metrics(self):
        a = pipeline.remember(self.alice, "스테이징 배포는 화요일 오전만 가능", project_key=GW)
        pipeline.undo(self.alice, a["event_id"])
        retrieval.recall(self.alice, "없는 내용 검색어 zzz", GW)
        o = admin.overview()
        self.assertEqual(o["quality"]["remember_7d"], 1)
        self.assertEqual(o["quality"]["undo_7d"], 1)
        self.assertEqual(o["quality"]["zero_result_7d"], 1)
        self.assertEqual(o["system"]["llm_provider"], "heuristic")

    def test_offboard_deletes_personal_keeps_team_and_reassigns(self):
        a = pipeline.remember(self.alice, "게이트웨이 재시작 순서: broker 먼저", project_key=GW)
        tm = pipeline.promote(self.alice, [a["memo_id"]], self.team)["created"][0]["memo_id"]
        _, tok = api.issue_token(self.alice["id"], "장비")
        admin.offboard(self.op, self.alice["id"], "delete", reassign_to=self.bob["id"])
        self.assertIsNone(self.memo(a["memo_id"]))
        self.assertEqual(self.memo(tm)["author_id"], self.bob["id"])
        self.assertEqual(self.memo(tm)["status"], "active")
        with self.assertRaises(api.Unauthorized):
            api.auth_user({"Authorization": f"Bearer {tok}"})

    def test_delete_my_data(self):
        a = pipeline.remember(self.alice, "지워질 메모입니다 고유문자열QWV")
        sessions.upload(self.alice, "claude-code", "s9", GW, transcript="사용자: 안녕\n에이전트: 원인은 이것 때문입니다 충분히 긴 문장입니다")
        admin.delete_personal_data(self.alice["id"])
        self.assertIsNone(self.memo(a["memo_id"]))
        self.assertEqual(db.val("SELECT COUNT(*) FROM sessions WHERE user_id=?", self.alice["id"]), 0)
        self.assertEqual(db.q("SELECT rowid FROM memos_fts WHERE memos_fts MATCH '\"고유문자열QWV\"'"), [])

    def test_budget_falls_back_to_rules(self):
        from conntext import llm
        db.insert("metrics", kind="llm", name="analyze", value=1, tokens_in=10**7, tokens_out=0, user_id=self.alice["id"], ok=1, created_at=db.now())
        self.assertTrue(llm._over_budget(self.alice["id"]))
        self.assertFalse(llm._over_budget(self.bob["id"]))


class TestProjectKey(unittest.TestCase):
    def test_normalize(self):
        n = mcp.normalize_project
        self.assertEqual(n("git@github.com:Connectivity/BLE-Gateway.git"), GW)
        self.assertEqual(n("https://github.com/connectivity/ble-gateway.git"), GW)
        self.assertEqual(n("https://user:pw@github.com/connectivity/ble-gateway"), GW)
        self.assertEqual(n("ssh://git@git.corp.example:2222/conn/ota.git"), "git.corp.example/conn/ota")
        self.assertEqual(n("/home/dev/work/Scratch"), "local:scratch")
        self.assertIsNone(n(""))
        self.assertIsNone(n(None))


class TestHTTP(Base):
    def setUp(self):
        super().setUp()
        self.srv = api.make_server("127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        _, self.tok = api.issue_token(self.alice["id"], "테스트")
        _, self.bob_tok = api.issue_token(self.bob["id"], "테스트")
        _, self.op_tok = api.issue_token(self.op["id"], "테스트")

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        super().tearDown()

    def call(self, method, path, body=None, tok="alice", headers=None):
        tok = {"alice": self.tok, "bob": self.bob_tok, "op": self.op_tok, None: None}.get(tok, tok)
        h = {"Content-Type": "application/json", **(headers or {})}
        if tok:
            h["Authorization"] = f"Bearer {tok}"
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, headers=h,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            return e.code, (json.loads(raw) if raw else None)

    def rpc(self, method, params=None, id_=1, tok="alice"):
        return self.call("POST", "/mcp", {"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}, tok)

    def tool(self, name, args, tok="alice"):
        code, r = self.rpc("tools/call", {"name": name, "arguments": args}, tok=tok)
        self.assertEqual(code, 200)
        return r["result"]

    def test_auth_required(self):
        self.assertEqual(self.call("GET", "/api/me", tok=None)[0], 401)
        self.assertEqual(self.call("GET", "/api/me", tok="ctx_wrong")[0], 401)
        self.assertEqual(self.call("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, tok=None)[0], 401)
        self.assertEqual(self.call("GET", "/api/health", tok=None)[0], 200)

    def test_revoked_token_stops_working(self):
        code, r = self.call("POST", "/api/tokens", {"label": "노트북"})
        tid, tok = r["id"], r["token"]
        self.assertEqual(self.call("GET", "/api/me", tok=tok)[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/tokens/{tid}")[0], 200)
        self.assertEqual(self.call("GET", "/api/me", tok=tok)[0], 401)

    def test_admin_routes_are_role_gated(self):
        self.assertEqual(self.call("GET", "/api/admin/overview")[0], 403)
        self.assertEqual(self.call("GET", "/api/admin/overview", tok="op")[0], 200)
        self.assertEqual(self.call("POST", "/api/admin/breakglass", {"user_id": self.bob["id"], "reason": "x" * 20})[0], 403)
        aud = self.user("aud@t", "감사", "auditor")
        _, atok = api.issue_token(aud["id"], "t")
        self.assertEqual(self.call("GET", "/api/admin/audit", tok=atok)[0], 200)
        self.assertEqual(self.call("GET", "/api/admin/users", tok=atok)[0], 403)

    def test_masking_test_reports_broken_rule(self):
        code, r = self.call("POST", "/api/admin/masking-test", {"text": "EMP-123456", "rules": [
            {"name": "사번", "pattern": r"EMP-\d{6}"}, {"name": "깨진 규칙", "pattern": "([a-z"}]}, tok="op")
        self.assertEqual(code, 400)
        self.assertIn("깨진 규칙", r["error"])
        self.assertIn("2번째", r["error"])
        db.set_policy("masking_rules", [{"name": "저장된 깨진 규칙", "pattern": "(?P<x"}])   # 규칙을 안 주면 저장된 정책을 시험한다
        code, r = self.call("POST", "/api/admin/masking-test", {"text": "x"}, tok="op")
        self.assertEqual(code, 400)
        self.assertIn("저장된 깨진 규칙", r["error"])
        code, r = self.call("POST", "/api/admin/masking-test", {"text": "담당 EMP-123456", "rules": [{"name": "사번", "pattern": r"EMP-\d{6}"}]}, tok="op")
        self.assertEqual((code, r["count"]), (200, 1))

    def test_role_denial_records_path(self):
        self.assertEqual(self.call("GET", "/api/admin/users")[0], 403)
        row = db.one("SELECT * FROM audit_log WHERE action='access_denied'")
        self.assertEqual((row["actor_id"], db.js(row["detail"])["path"]), (self.alice["id"], "GET /api/admin/users"))

    def test_audit_filter_and_paging(self):
        for i in range(5):
            db.audit(self.op["id"], "reprocess", "pipeline", i)
        for i in range(2):
            db.audit(self.bob["id"], "team_member", "space", i)
        code, r = self.call("GET", f"/api/admin/audit?actor_id={self.op['id']}&limit=2", tok="op")
        self.assertEqual([e["actor_id"] for e in r["entries"]], [self.op["id"]] * 2)
        seen = [e["id"] for e in r["entries"]]
        while r["next_before"]:
            code, r = self.call("GET", f"/api/admin/audit?actor_id={self.op['id']}&limit=2&before={r['next_before']}", tok="op")
            seen += [e["id"] for e in r["entries"]]
        self.assertEqual(len(seen), 5)
        self.assertEqual(seen, sorted(seen, reverse=True))
        code, r = self.call("GET", "/api/admin/audit?limit=7", tok="op")
        self.assertEqual((len(r["entries"]), r["next_before"]), (7, None))

    def test_create_user_api_rejects_bad_input(self):
        code, r = self.call("POST", "/api/admin/users", {"email": "nope", "name": "x"}, tok="op")
        self.assertEqual(code, 400)
        self.assertIn("이메일", r["error"])
        code, r = self.call("POST", "/api/admin/users", {"email": "ok@corp.example", "name": ""}, tok="op")
        self.assertEqual(code, 400)
        self.assertIn("이름", r["error"])

    def test_budget_put_drops_retired_key(self):
        code, _ = self.call("PUT", "/api/admin/policies/budget", {"value": {"daily_tokens_per_user": 5000, "on_exceed": "defer"}}, tok="op")
        self.assertEqual(code, 200)
        self.assertEqual(db.policy("budget"), {"daily_tokens_per_user": 5000})
        self.assertNotIn("on_exceed", db.one("SELECT value FROM policies WHERE key='budget'")["value"])

    def test_mcp_handshake_and_tools(self):
        code, r = self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
        self.assertEqual(code, 200)
        self.assertEqual(r["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(r["result"]["serverInfo"]["name"], "conntext")
        code, r = self.call("POST", "/mcp", {"jsonrpc": "2.0", "method": "notifications/initialized"})
        self.assertEqual(code, 202)
        _, r = self.rpc("tools/list")
        names = {t["name"] for t in r["result"]["tools"]}
        self.assertEqual(names, {"remember", "recall", "get_memos", "get_topic", "resume", "handoff", "forget", "mark_used"})
        _, r = self.rpc("nope/nope")
        self.assertEqual(r["error"]["code"], -32601)

    def test_mcp_remember_recall_forget_roundtrip(self):
        url = "git@github.com:connectivity/ble-gateway.git"
        r = self.tool("remember", {"text": "스테이징 배포는 화요일 오전만 가능", "project": url})
        self.assertFalse(r["isError"])
        self.assertIn("저장됨", r["content"][0]["text"])
        self.assertIn("ble-gateway", r["content"][0]["text"])
        r = self.tool("remember", {"text": "스테이징 배포는 목요일 오전만 가능하도록 변경됨", "project": url})
        self.assertIn("이전 메모 1건 대체", r["content"][0]["text"])
        r = self.tool("recall", {"query": "스테이징 배포 요일", "project": "https://github.com/connectivity/ble-gateway"})
        text = r["content"][0]["text"]
        self.assertIn("[내 메모]", text)
        self.assertIn("목요일", text)
        self.assertNotIn("화요일 오전만 가능\n", text.split("── ")[0])
        r = self.tool("forget", {"query": "스테이징 배포"})
        self.assertIn("후보", r["content"][0]["text"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM memos WHERE status='deleted'"), 0)       # query만으로는 지우지 않는다
        r = self.tool("forget", {"undo_last": True})
        self.assertIn("되돌렸습니다", r["content"][0]["text"])
        r = self.tool("recall", {"query": "스테이징 배포 요일", "project": url})
        self.assertIn("화요일", r["content"][0]["text"])
        self.assertTrue(self.tool("remember", {"text": ""})["isError"])
        self.assertTrue(self.tool("get_topic", {"id": 9999})["isError"])

    def test_mcp_cannot_touch_other_users_memo(self):
        a = pipeline.remember(self.alice, "앨리스의 개인 메모 내용입니다")
        r = self.tool("forget", {"memo_id": a["memo_id"]}, tok="bob")
        self.assertTrue(r["isError"])
        self.assertEqual(self.memo(a["memo_id"])["status"], "active")
        r = self.tool("get_memos", {"ids": [a["memo_id"]]}, tok="bob")
        self.assertNotIn("앨리스의 개인 메모", r["content"][0]["text"])
        r = self.tool("remember", {"text": "밥이 덮어쓰려는 내용입니다", "replaces": a["memo_id"]}, tok="bob")
        self.assertTrue(r["isError"])

    def test_handoff_then_resume_across_platforms(self):
        url = "git@github.com:connectivity/ble-gateway.git"
        self.tool("handoff", {"text": "완료: 미들웨어 리팩터링. 남은 일: broker/acl_cache.py TTL 확인", "project": url})
        code, r = self.call("POST", "/api/hooks/session-start", {"platform": "opencode", "session_id": "oc-1", "project": "https://github.com/connectivity/ble-gateway.git", "cwd": "/w"},
                            headers={"X-Conntext-Client": "opencode/0.1.0"})
        self.assertEqual(code, 200)
        self.assertIn("acl_cache.py", r["context"])
        self.assertIn(f"project: {GW}", r["context"])
        self.assertEqual(db.one("SELECT client_platform, client_version FROM tokens WHERE token_hash=?", api._hash(self.tok)),
                         {"client_platform": "opencode", "client_version": "0.1.0"})
        self.assertIn("acl_cache.py", self.tool("resume", {"project": url})["content"][0]["text"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM injections"), 1)

    def test_hook_upload_and_session_api(self):
        code, r = self.call("POST", "/api/hooks/session-upload", {"platform": "claude-code", "session_id": "cc-9", "project": GW, "transcript": TestSessions.JSONL, "reason": "exit"})
        self.assertEqual((code, r["status"]), (200, "uploaded"))
        jobs.drain()
        code, r = self.call("GET", "/api/sessions")
        self.assertEqual(r["sessions"][0]["status"], "extracted")
        sid = r["sessions"][0]["id"]
        self.assertEqual(self.call("GET", f"/api/sessions/{sid}", tok="bob")[0], 404)
        code, home = self.call("GET", "/api/home")
        self.assertTrue(home["candidates"])
        self.assertTrue(home["states"])
        cid = home["candidates"][0]["id"]
        self.assertEqual(self.call("POST", f"/api/memos/{cid}/confirm")[0], 200)
        self.assertEqual(self.memo(cid)["trust"], "high")
        self.assertEqual(self.call("DELETE", f"/api/sessions/{sid}")[0], 200)
        self.assertEqual(self.memo(cid)["status"], "active")            # 확인한 메모는 세션을 지워도 남는다

    def test_web_search_does_not_inflate_usage(self):
        mid = pipeline.remember(self.alice, "OTA 청크 크기는 MTU 247 기준 244바이트", project_key=OTA)["memo_id"]
        for q in ("OT", "OTA", "OTA 청", "OTA 청크", "OTA 청크 크기"):                # 타이핑 중 연속 검색
            code, r = self.call("GET", "/api/search?q=" + urllib.parse.quote(q))
            self.assertEqual(code, 200)
        self.assertIn(mid, [x["id"] for x in r["results"]])
        self.assertEqual(db.val("SELECT COUNT(*) FROM memo_uses"), 0)
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind IN ('search','latency') AND name='recall'"), 0)
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind='cmd' AND name='web:search'"), 1)
        db.ex("UPDATE metrics SET created_at=created_at-? WHERE name='web:search'", api.WEB_SEARCH_WINDOW + 1)
        self.call("GET", "/api/search?q=" + urllib.parse.quote("OTA 청크"))               # 시간이 지난 새 검색은 센다
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind='cmd' AND name='web:search'"), 2)
        self.tool("recall", {"query": "OTA 청크 크기"})                                     # 에이전트 recall은 지금처럼 기록한다
        self.assertGreater(db.val("SELECT COUNT(*) FROM memo_uses WHERE kind='recall' AND memo_id=?", mid), 0)
        self.assertEqual(db.val("SELECT COUNT(*) FROM metrics WHERE kind='search' AND name='recall'"), 1)

    def test_session_injection_ids_are_arrays(self):
        mid = pipeline.remember(self.alice, "답변은 항상 한국어로 해 줘")["memo_id"]
        sessions.start(self.alice, "claude-code", "s-inj", GW)
        sid = db.val("SELECT id FROM sessions WHERE ext_id='s-inj'")
        code, s = self.call("GET", f"/api/sessions/{sid}")
        self.assertEqual(code, 200)
        self.assertIsInstance(s["injection"]["memo_ids"], list)
        self.assertIsInstance(s["injection"]["topic_ids"], list)
        self.assertIn(mid, s["injection"]["memo_ids"])
        code, a = self.call("GET", "/api/agent/injections")
        self.assertEqual(a["injections"][0]["memo_ids"], s["injection"]["memo_ids"])

    def test_kind_change_events_keep_their_own_kind(self):
        mid = pipeline.remember(self.alice, "스테이징 배포는 목요일 오전만 가능", project_key=GW)["memo_id"]
        self.call("PUT", f"/api/memos/{mid}", {"kind": "instruction"})
        self.call("PUT", f"/api/memos/{mid}", {"kind": "state"})
        code, h = self.call("GET", "/api/home")
        evs = [e for e in h["events"] if e["action"] == "kind_change"]
        self.assertEqual([(e["prev_kind"], e["kind"]) for e in evs], [("instruction", "state"), ("knowledge", "instruction")])
        self.assertTrue(all(e["memo"]["kind"] == "state" for e in evs))                   # 현재 종류는 memo.kind
        self.assertEqual([e["kind"] for e in h["events"] if e["action"] == "remember"], ["knowledge"])

    def test_kind_only_put_changes_kind_in_place(self):
        code, r = self.call("POST", "/api/memos", {"text": "스테이징 배포는 목요일 오전만 가능", "project_key": GW})
        mid = r["memo_id"]
        self.assertEqual(self.call("PUT", f"/api/memos/{mid}", {"kind": "instruction"}, tok="bob")[0], 403)
        code, r = self.call("PUT", f"/api/memos/{mid}", {"kind": "instruction"})
        self.assertEqual(code, 200)
        self.assertEqual((r["memo_id"], r["kind"], r["topics"]), (mid, "instruction", []))   # 새 판을 만들지 않는다
        self.assertEqual(self.memo(mid)["status"], "active")
        self.assertEqual(self.call("PUT", f"/api/memos/{mid}", {"kind": "nope"})[0], 400)
        code, h = self.call("GET", "/api/home")
        ev = h["events"][0]
        self.assertEqual((ev["action"], ev["prev_kind"], ev["memo"]["kind"], ev["undoable"]), ("kind_change", "knowledge", "instruction", True))
        self.assertEqual(self.call("POST", f"/api/events/{r['event_id']}/undo")[0], 200)
        self.assertEqual(self.memo(mid)["kind"], "knowledge")
        code, r2 = self.call("PUT", f"/api/memos/{mid}", {"text": "스테이징 배포는 금요일 오전만 가능", "kind": "instruction"})
        self.assertNotEqual(r2["memo_id"], mid)                                      # 본문이 오면 지금처럼 새 판으로 대체
        self.assertEqual(self.memo(mid)["status"], "superseded")

    def test_web_flow(self):
        code, r = self.call("POST", "/api/memos", {"text": "OTA 청크 크기는 MTU 247 기준 244바이트", "project_key": OTA})
        self.assertEqual(code, 200)
        mid, eid = r["memo_id"], r["event_id"]
        jobs.drain()
        code, t = self.call("GET", "/api/topics")
        self.assertEqual(len(t["topics"]), 1)
        code, d = self.call("GET", f"/api/topics/{t['topics'][0]['id']}")
        self.assertIn(f"[m:{mid}]", d["topic"]["summary"])
        self.assertEqual(self.call("GET", f"/api/topics/{t['topics'][0]['id']}", tok="bob")[0], 403)
        code, p = self.call("GET", f"/api/agent/preview?project={OTA}")
        self.assertIn("OTA 청크", p["text"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM injections"), 0)           # 미리보기는 주입 기록을 남기지 않는다
        self.assertEqual(self.call("POST", f"/api/events/{eid}/undo")[0], 200)
        self.assertEqual(self.call("POST", f"/api/events/{eid}/undo", tok="bob")[0], 404)
        code, r = self.call("POST", "/api/memos", {"text": "팀에 바로 쓰기", "space_id": self.team})
        self.assertEqual(code, 400)
        self.assertEqual(self.call("POST", "/api/memos", {"text": ""})[0], 400)
        self.assertEqual(self.call("GET", "/api/nope")[0], 404)

    def test_promote_api_and_report(self):
        _, r = self.call("POST", "/api/memos", {"text": "게이트웨이 재시작 순서: broker 먼저, 그 다음 bridge", "project_key": GW})
        code, pv = self.call("POST", "/api/promote", {"memo_ids": [r["memo_id"]], "team_space_id": self.team, "dry_run": True})
        self.assertTrue(pv["dry_run"])
        self.assertEqual(db.val("SELECT COUNT(*) FROM memos WHERE space_id=?", self.team), 0)
        code, pr = self.call("POST", "/api/promote", {"memo_ids": [r["memo_id"]], "team_space_id": self.team})
        tm = pr["created"][0]["memo_id"]
        code, rep = self.call("POST", "/api/reports", {"memo_id": tm, "reason": "순서 제약이 없어졌습니다"}, tok="bob")
        self.assertEqual(code, 200)
        code, home = self.call("GET", f"/api/home?space_id={self.team}", tok="bob")
        self.assertEqual(len(home["reports"]), 1)
        self.assertEqual(self.call("POST", f"/api/reports/{rep['id']}/resolve", {"action": "remove"})[0], 403)      # 앨리스는 팀 관리자가 아니다
        self.assertEqual(self.call("POST", f"/api/reports/{rep['id']}/resolve", {"action": "remove"}, tok="bob")[0], 200)
        self.assertEqual(self.memo(tm)["status"], "deleted")

    def test_policy_validation(self):
        code, r = self.call("PUT", "/api/admin/policies/masking_rules", {"value": [{"name": "깨진 규칙", "pattern": "([a-z"}]}, tok="op")
        self.assertEqual(code, 400)
        code, r = self.call("PUT", "/api/admin/policies/masking_rules", {"value": [{"name": "사번", "pattern": r"EMP-\d{6}"}]}, tok="op")
        self.assertEqual(code, 200)
        code, r = self.call("POST", "/api/memos", {"text": "담당자 사번은 EMP-123456 이다"})
        self.assertEqual(r["masked"], 1)

    def test_static_and_traversal(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/../server/conntext/config.py")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
