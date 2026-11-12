"""환경 변수 기반 설정. 의존성 없이 표준 라이브러리만 쓴다."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("CONNTEXT_DATA", ROOT / "data"))
DB_PATH = Path(os.environ.get("CONNTEXT_DB", DATA_DIR / "conntext.db"))
WEB_DIR = ROOT / "web"
HOST = os.environ.get("CONNTEXT_HOST", "0.0.0.0")
PORT = int(os.environ.get("CONNTEXT_PORT", "7373"))
PUBLIC_URL = os.environ.get("CONNTEXT_PUBLIC_URL", f"http://localhost:{PORT}")
# 개발용 로그인(이메일만으로 로그인). 사내 SSO를 붙이기 전까지의 PoC 수단이다.
DEV_LOGIN = os.environ.get("CONNTEXT_DEV_LOGIN", "1") == "1"

# LLM: auto | anthropic | openai | claude-cli | heuristic
LLM_PROVIDER = os.environ.get("CONNTEXT_LLM", "auto")
LLM_MODEL = os.environ.get("CONNTEXT_LLM_MODEL", "")
LLM_BASE_URL = os.environ.get("CONNTEXT_LLM_BASE_URL", "")   # OpenAI 호환 엔드포인트(사내 모델)
LLM_API_KEY = os.environ.get("CONNTEXT_LLM_API_KEY", "")
LLM_TIMEOUT = float(os.environ.get("CONNTEXT_LLM_TIMEOUT", "60"))
# 임베딩: local(문자 n-gram 해싱) | openai(호환 엔드포인트)
EMBED_PROVIDER = os.environ.get("CONNTEXT_EMBED", "local")
EMBED_BASE_URL = os.environ.get("CONNTEXT_EMBED_BASE_URL", "")
EMBED_MODEL = os.environ.get("CONNTEXT_EMBED_MODEL", "")
EMBED_API_KEY = os.environ.get("CONNTEXT_EMBED_API_KEY", "")

PIPELINE_VERSION = "p2"          # 프롬프트·판정 로직이 바뀌면 올린다. 재처리 대상 선별에 쓴다.
MIN_PLUGIN_VERSION = "0.1.0"
