"""임베딩. 기본은 외부 호출이 없는 문자 n-gram 해싱 벡터이고,
CONNTEXT_EMBED=openai 로 사내 임베딩 엔드포인트(OpenAI 호환)를 쓸 수 있다."""
import array, hashlib, json, math, re, urllib.request
from . import config

DIM = 512
_ws = re.compile(r"\s+")


def _local(text):
    t = _ws.sub(" ", text.lower()).strip()
    vec = [0.0] * DIM
    grams = []
    for w in t.split(" "):
        if len(w) >= 2:
            grams.append("w:" + w)
    s = t.replace(" ", "")
    for n in (2, 3):
        grams += [s[i:i + n] for i in range(max(0, len(s) - n + 1))]
    for g in grams:
        h = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "little")
        vec[h % DIM] += 1.0 if (h >> 40) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _remote(text):
    body = json.dumps({"model": config.EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(config.EMBED_BASE_URL.rstrip("/") + "/embeddings", data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {config.EMBED_API_KEY}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        v = json.load(r)["data"][0]["embedding"]
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def embed(text):
    if config.EMBED_PROVIDER == "openai" and config.EMBED_BASE_URL:
        try:
            return _remote(text)
        except Exception:
            pass
    return _local(text)


def pack(vec):
    return array.array("f", vec).tobytes()


def unpack(blob):
    a = array.array("f")
    a.frombytes(blob)
    return a


def cosine(a, b):
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))
