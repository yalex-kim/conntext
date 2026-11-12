"""공간 접근 제어. 권한 거부는 지표(authz)와 감사 로그(access_denied)에 함께 남긴다."""
from . import db


class Forbidden(Exception):
    pass


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


def personal_space_id(user_id):
    sid = db.val("SELECT id FROM spaces WHERE kind='personal' AND owner_id=?", user_id)
    if sid is None:
        name = db.val("SELECT name FROM users WHERE id=?", user_id, default="")
        sid = db.insert("spaces", kind="personal", name=f"{name}의 공간", owner_id=user_id, created_at=db.now())
        db.insert("space_members", space_id=sid, user_id=user_id, role="admin")
    return sid


def user_spaces(user_id):
    personal_space_id(user_id)
    return db.q("SELECT s.id, s.kind, s.name, m.role FROM spaces s JOIN space_members m ON m.space_id=s.id "
                "WHERE m.user_id=? ORDER BY s.kind='team', s.name", user_id)


def space_ids(user_id):
    return [s["id"] for s in user_spaces(user_id)]


def role_in(user_id, space_id):
    return db.val("SELECT role FROM space_members WHERE space_id=? AND user_id=?", space_id, user_id)


def require_read(user, space_id):
    if role_in(user["id"], space_id) is None:
        db.metric("authz", "space_read_denied", user_id=user["id"], ok=False)
        db.audit(user["id"], "access_denied", "space", space_id, space_id, denied="space_read")
        raise Forbidden("이 공간에 접근할 권한이 없습니다.")


def require_team_admin(user, space_id):
    if role_in(user["id"], space_id) != "admin":
        db.metric("authz", "space_admin_denied", user_id=user["id"], ok=False)
        db.audit(user["id"], "access_denied", "space", space_id, space_id, denied="space_admin")
        raise Forbidden("팀 관리자만 할 수 있는 작업입니다.")


def require_role(user, *roles, path=None):
    if user["role"] not in roles:
        db.metric("authz", "role_denied", user_id=user["id"], ok=False)
        db.audit(user["id"], "access_denied", "role", None, None, denied="role", required=list(roles), path=path)
        raise Forbidden("권한이 없습니다.")


def get_memo(user, memo_id, write=False):
    m = db.one("SELECT * FROM memos WHERE id=?", memo_id)
    if not m:
        raise NotFound("메모를 찾을 수 없습니다.")
    require_read(user, m["space_id"])
    if write:
        sp = db.one("SELECT kind FROM spaces WHERE id=?", m["space_id"])
        if sp["kind"] == "team" and m["author_id"] != user["id"]:
            require_team_admin(user, m["space_id"])
    return m
