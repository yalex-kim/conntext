# 기초 층 사용법 (base.css, 아이콘, 브랜드)

정본은 `web/assets/base.css` 맨 위 주석과 `/styleguide.html`(http://localhost:7373/styleguide.html)이다. 부품의 실제 모습과 마크업은 스타일 가이드에서 확인한다. 이미 있는 부품은 새로 만들지 말고 가져다 쓴다. 필요한 부품이 없으면 자기 표면의 CSS에 만들되 토큰을 쓴다. `base.css`는 고치지 않는다(세 표면이 공유한다). 고쳐야 할 결함을 발견하면 보고에 적는다.

## 불러오기
```html
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<meta property="og:image" content="/assets/brand/og.png">
<link rel="stylesheet" href="/assets/base.css">
```

## 토큰
- 글자·선: `--ink` `--ink-2`(보조, 4.5:1 이상) `--ink-3`(비활성·눈금 전용, 본문 금지) `--line` `--line-strong`
- 바탕: `--ground` `--surface` `--sunken`
- 노랑: `--marker` `--marker-deep` `--marker-soft`
- 등급·상태: `--team`/`--team-ink`/`--team-soft`, `--state`/…, `--warn`/…, `--danger`/… (`-ink`는 밝은 바탕 위 글자, `-soft`는 옅은 면)
- 잉크 바탕 위: `--on-ink` `--on-ink-2` `--ink-hover` `--ink-line`, 포커스 `--focus`
- 그림(시퀀스 차트·프레임 포맷): `--dg-line` `--dg-line-2` `--dg-tick` `--dg-tick-label` `--dg-grid` `--dg-field` `--dg-field-alt` `--dg-hair`(1px) `--dg-stroke`(1.5px)
- 터미널: `--term-bg` `--term-fg` `--term-dim` `--term-prompt` `--term-ok` `--term-err`
- 글꼴: `--font-display`(Paperlogy 700/800) `--font-ui`(SUIT) `--font-mono`(D2Coding)
- 글자 크기 `--fs-1`(12) ~ `--fs-9`(40–80 유동), 본문 `--fs-4`(16). 줄 간격 `--lh-tight` `--lh-ui` `--lh-body`, 폭 `--measure`(68ch)
- 간격 `--s-1`(4) ~ `--s-9`(96), 반경 `--r-1` `--r-2` `--r-3` `--r-pill`, 그림자 `--shadow-1..3`
- 움직임 `--ease-out` `--dur-1..3`, 컨트롤 높이 `--control-h`(36) `--control-h-sm`(28) `--control-h-lg`(44)

## 부품
- 버튼: `.btn`(보조) `.btn--primary` `.btn--quiet` `.btn--danger`, 크기 `.btn--sm` `.btn--lg`, 아이콘만 `.btn--icon`(aria-label 필수). 로딩은 `aria-busy="true"`와 글자를 `<span>`으로 감싸기.
- 입력: `<div class="field"><label class="field__label" for="x">…</label><input class="input" id="x"><p class="field__hint">…</p></div>`. `.select` `.textarea` `.input--mono` `.input--sm`. 오류는 `aria-invalid="true"` + `.field__error`. 체크 `.check`, 스위치 `<label class="switch"><input type="checkbox" role="switch"> …</label>`.
- 등급 태그: `<span class="tag tag--mine">m:142</span>`, `.tag--team`(+ `<span class="tag-by">작성자</span>`), `.tag--candidate`, `.tag--state`, `.tag--superseded`, 큰 크기 `.tag--lg`. `<a class="tag …">`도 된다.
- 표식: `.chip`, `.chip--scope`(아이콘 포함), `.chip--mono`(저장소 이름).
- 표: `<div class="table-wrap"><table class="table">…<td class="num">204</td></table></div>`, 선택 행 `tr[aria-selected="true"]`.
- 탭: `<nav class="tabs"><a aria-current="page">…</a><a>…</a></nav>`. 패널: `.panel`(패널 안에 패널 금지).
- 터미널: `<div class="term"><div class="term__head"><span class="term__title">bash</span><button class="btn btn--quiet btn--sm">복사</button></div><pre><span class="term__prompt">$ </span>명령</pre></div>`, 줄 색 `.term__out` `.term__dim` `.term__ok` `.term__err`.
- 알림: `<div class="alert" role="status"><svg class="icon">…#info</svg><div><p class="alert__title">…</p><p>…</p></div></div>`, `.alert--warn`, `.alert--danger`(role="alert").
- 빈 상태: `<div class="empty"><svg class="icon empty__icon">…</svg><p class="empty__title">…</p><p>…</p><button class="btn btn--primary">…</button></div>`.
- 잉크 바탕 영역: 감싸는 요소에 `class="on-ink"`. 안의 글자, 포커스, 버튼, 칩이 맞게 바뀐다.
- 기타: `.spinner`, `.kbd`, `.muted`, `.num`, `.mono`, `.sr-only`, `.wordmark`(높이 24px).

## 아이콘
`<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#이름"/></svg>` (기본 20, `.icon--sm` 16, `.icon--lg` 24)

home, wiki, memo, agent, session, team, settings, admin, search, plus, check, x, undo, edit, trash, copy, external, share, pause, play, shield, alert, info, chevron-down, chevron-right, arrow-right, link, clock, filter, download, upload, user, key, refresh

필요한 아이콘이 없으면 같은 규칙(24 격자, 선 1.75, 둥근 끝, currentColor)으로 자기 표면에 인라인 SVG로 그린다.

## 브랜드와 사진
- 워드마크: `/assets/brand/wordmark.svg`(밝은 바탕), `/assets/brand/wordmark-on-ink.svg`(잉크 바탕), `/assets/brand/wordmark-connpass.svg`(자매 서비스)
- 심볼: `/assets/brand/mark.svg` (노치 있는 노란 라벨 태그 + `nn`). 파비콘은 `/assets/brand/favicon.svg`(16px용으로 굵게 한 판).
- 사진: `/assets/img/cables-1376.webp`, `/assets/img/cables-800.webp`. 서버 랙의 남색 케이블 다발에 노란 라벨이 감긴 사진. 노란 라벨은 오른쪽 아래 3분의 1에 초점이 맞아 있다. `srcset`으로 쓴다.

## 지킬 것
- 노랑 위 글자는 항상 `--ink`. 노랑 글자를 밝은 바탕에 쓰지 않는다.
- `--ink-3`는 본문 글자에 쓰지 않는다(3.4:1).
