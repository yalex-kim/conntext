"""저장 전 마스킹. 서버에 들어온 원문은 이 단계를 거친 뒤에만 DB에 닿는다."""
import re
from . import db

PRIVATE = re.compile(r"<private>[\s\S]*?</private>", re.I)


def validate(rules):
    """규칙 목록을 검사한다. 틀린 규칙이 있으면 어느 규칙이 왜 틀렸는지 BadRequest로 알린다.
    시험과 정책 저장에서만 쓴다. 실제 마스킹(mask)은 틀린 규칙을 건너뛰고 계속 저장한다."""
    from .access import BadRequest
    if not isinstance(rules, list):
        raise BadRequest("마스킹 규칙은 목록이어야 합니다.")
    for i, r in enumerate(rules, 1):
        if not isinstance(r, dict) or not isinstance(r.get("pattern"), str) or not r["pattern"]:
            raise BadRequest(f"{i}번째 규칙에 정규식(pattern)이 없습니다.")
        try:
            re.compile(r["pattern"])
        except re.error as e:
            raise BadRequest(f"정규식 오류({i}번째 규칙 '{r.get('name') or '이름 없음'}'): {e}")


def mask(text, rules=None):
    """(마스킹된 본문, 마스킹 건수)를 돌려준다."""
    if not text:
        return "", 0
    rules = rules if rules is not None else db.policy("masking_rules")
    n = 0
    text, k = PRIVATE.subn("[비공개 처리됨]", text)
    n += k
    for r in rules:
        try:
            rx = re.compile(r["pattern"])
        except re.error:
            continue
        label = r.get("name", "민감 정보")

        def repl(m, label=label, rx=rx):
            # 'key = 값' 꼴은 키 이름을 남겨 문맥을 보존한다.
            if rx.groups >= 2 and m.group(1) and m.group(2):
                return f"{m.group(1)}{m.group(2)}[마스킹: {label}]"
            return f"[마스킹: {label}]"
        text, k = rx.subn(repl, text)
        n += k
    return text, n
