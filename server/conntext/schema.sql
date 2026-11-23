PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',            -- user | operator | auditor
  capture_paused INTEGER NOT NULL DEFAULT 0, llm_budget_tokens INTEGER,
  prompt_recall_off INTEGER NOT NULL DEFAULT 0,  -- 질문마다 관련 메모 넣기를 이 사용자가 껐는지(#12)
  created_at INTEGER NOT NULL, deactivated_at INTEGER);
CREATE TABLE IF NOT EXISTS spaces(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL,   -- personal | team
  name TEXT NOT NULL, owner_id INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS space_members(
  space_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'member', -- member | admin
  PRIMARY KEY(space_id, user_id));
CREATE TABLE IF NOT EXISTS tokens(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT UNIQUE NOT NULL, prefix TEXT NOT NULL,
  label TEXT, kind TEXT NOT NULL DEFAULT 'client',  -- client | web
  client_platform TEXT, client_version TEXT,
  created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS memos(
  id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL, author_id INTEGER NOT NULL,
  body TEXT NOT NULL, title TEXT,
  kind TEXT NOT NULL DEFAULT 'knowledge',       -- instruction | knowledge | procedure | state
  when_hint TEXT,                               -- procedure: 언제 쓰는 절차인지 한 줄(#16)
  source TEXT NOT NULL DEFAULT 'manual',        -- manual | session | import | promoted
  trust TEXT NOT NULL DEFAULT 'high',           -- high | low | temp
  scope TEXT NOT NULL DEFAULT 'global',         -- global | project
  project_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active | superseded | duplicate | deleted | expired | dismissed
  superseded_by INTEGER, origin_memo_id INTEGER, origin_session_id INTEGER,
  source_acl TEXT,                              -- JSON list: 원본 문서 권한 라벨
  masked_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB, pipeline_version TEXT,
  use_count INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS memos_space ON memos(space_id, status, created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(body, title, tokenize='trigram');
CREATE TABLE IF NOT EXISTS topics(
  id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL, title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', project_key TEXT, origin_topic_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'knowledge',       -- knowledge | procedure: 지식 문서와 절차 문서는 섞지 않는다
  dirty INTEGER NOT NULL DEFAULT 1, pipeline_version TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memo_topics(memo_id INTEGER NOT NULL, topic_id INTEGER NOT NULL, PRIMARY KEY(memo_id, topic_id));
CREATE TABLE IF NOT EXISTS entities(
  id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'term',
  UNIQUE(space_id, name));
CREATE TABLE IF NOT EXISTS memo_entities(memo_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, PRIMARY KEY(memo_id, entity_id));
CREATE TABLE IF NOT EXISTS links(
  a_memo INTEGER NOT NULL, b_memo INTEGER NOT NULL, relation TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(a_memo, b_memo));
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT NOT NULL, ext_id TEXT NOT NULL,
  project_key TEXT, cwd TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open',          -- open | uploaded | extracted | excluded | failed
  transcript TEXT, transcript_chars INTEGER NOT NULL DEFAULT 0, masked_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT, handoff TEXT, source_acl TEXT, pipeline_version TEXT,
  extracted_tail TEXT,                          -- 추출을 마친 대화록의 끝 부분. 다음 추출은 이 뒤만 본다(#18)
  checkpoints INTEGER NOT NULL DEFAULT 0,       -- 대화 중 체크포인트 추출 횟수
  UNIQUE(user_id, platform, ext_id));
CREATE TABLE IF NOT EXISTS ingest_events(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, space_id INTEGER NOT NULL, memo_id INTEGER,
  action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, undone_at INTEGER);
CREATE TABLE IF NOT EXISTS injections(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT, session_ext_id TEXT, project_key TEXT,
  memo_ids TEXT NOT NULL DEFAULT '[]', topic_ids TEXT NOT NULL DEFAULT '[]',
  tokens INTEGER NOT NULL DEFAULT 0, ms REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
-- 질문마다 넣은 관련 메모(#12). 넣은 것이 없어도 한 줄을 남겨 호출 대비 주입 비율을 본다.
CREATE TABLE IF NOT EXISTS prompt_injections(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, platform TEXT, session_ext_id TEXT, project_key TEXT,
  memo_ids TEXT NOT NULL DEFAULT '[]', tokens INTEGER NOT NULL DEFAULT 0, ms REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memo_uses(
  id INTEGER PRIMARY KEY, memo_id INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, -- inject | recall | used
  session_ext_id TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS memo_uses_memo ON memo_uses(memo_id, kind);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  space_id INTEGER, detail TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
CREATE TABLE IF NOT EXISTS policies(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by INTEGER);
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',        -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, id);
CREATE TABLE IF NOT EXISTS metrics(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL,   -- latency | llm | hook | search | authz
  name TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER, ok INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS metrics_kind ON metrics(kind, name, created_at);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, memo_id INTEGER, topic_id INTEGER, space_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL, share_content INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', resolved_by INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE TABLE IF NOT EXISTS trace(
  id INTEGER PRIMARY KEY, memo_id INTEGER, session_id INTEGER, stage TEXT NOT NULL, result TEXT NOT NULL,
  ms REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trace_memo ON trace(memo_id);
-- 지난 세션 검색(#14): 축약 대화록을 줄 단위로 색인한다. 본인 세션만 검색한다.
CREATE VIRTUAL TABLE IF NOT EXISTS session_lines USING fts5(text, session_id UNINDEXED, line_no UNINDEXED, tokenize='trigram');
