#!/usr/bin/env python3
"""그림 생성 (패킷나이트와 같은 Gemini 이미지 API). 사용:
docker run --rm -v /volume1/docker/khva/secrets/gemini_api_key:/run/gemini_key:ro -v <작업폴더>:/w python:3.12-alpine \
  python -I /w/gen-image.py "<프롬프트>" /w/out.png [가로:세로]
"""
import base64, json, sys, urllib.request
key = open("/run/gemini_key").read().strip()
prompt, out = sys.argv[1], sys.argv[2]
aspect = sys.argv[3] if len(sys.argv) > 3 else "1:1"
body = {"contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect, "imageSize": "1K"}}}
req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent",
                             data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=240))
for c in r.get("candidates", []):
    for p in c.get("content", {}).get("parts", []):
        if "inlineData" in p:
            open(out, "wb").write(base64.b64decode(p["inlineData"]["data"])); print("saved", out, p["inlineData"]["mimeType"]); sys.exit(0)
print("no image:", json.dumps(r)[:500]); sys.exit(1)
