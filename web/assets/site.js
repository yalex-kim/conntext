// 소개 페이지와 매뉴얼의 작은 동작: 서버 주소 채우기, 복사 버튼, 매뉴얼 목차의 현재 위치와 접기.
document.documentElement.classList.add("js")

// 1. 명령 안의 서버 주소를 이 페이지를 연 주소로 바꾼다.
for (const el of document.querySelectorAll("[data-origin]")) el.textContent = location.origin

// 2. 복사: 프롬프트 기호와 출력 줄은 빼고 명령만 복사한다.
//    사내 망의 http 주소에서는 navigator.clipboard가 없으므로 textarea 방식으로 대신한다.
function commandText(pre) {
  const c = pre.cloneNode(true)
  c.querySelectorAll(".term__prompt, .term__out, .term__dim, .term__ok, .term__err").forEach((n) => n.remove())
  const lines = c.querySelectorAll(".term__line")
  const text = lines.length ? [...lines].map((l) => l.textContent).join("\n") : c.textContent
  return text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).join("\n")
}

async function copy(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true } catch {}
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
  document.body.append(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand("copy") } catch {}
  ta.remove()
  return ok
}

const live = document.createElement("p")
live.className = "sr-only"
live.setAttribute("aria-live", "polite")
document.body.append(live)

for (const btn of document.querySelectorAll("[data-copy]")) {
  const label = btn.querySelector("span") || btn
  const idle = label.textContent
  let timer
  btn.addEventListener("click", async () => {
    const pre = btn.closest(".term")?.querySelector("pre")
    if (!pre) return
    const ok = await copy(commandText(pre))
    label.textContent = ok ? "복사됨" : "복사하지 못했습니다"
    btn.classList.toggle("copied", ok)
    live.textContent = ok ? "명령을 복사했습니다." : "복사하지 못했습니다. 직접 선택해 복사하세요."
    clearTimeout(timer)
    timer = setTimeout(() => { label.textContent = idle; btn.classList.remove("copied") }, 1800)
  })
}

// 3. 매뉴얼: 목차의 현재 위치, 좁은 화면의 목차 접기.
const toc = document.querySelector(".toc")
if (toc) {
  const links = new Map()
  for (const a of toc.querySelectorAll('a[href^="#"]')) {
    const el = document.getElementById(a.getAttribute("href").slice(1))
    if (el) links.set(el, a)
  }
  const targets = [...links.keys()]
  let current = null
  const update = () => {
    const line = window.innerHeight * 0.22
    let hit = targets[0]
    for (const t of targets) {
      if (t.getBoundingClientRect().top <= line) hit = t
      else break
    }
    if (hit === current) return
    if (current) links.get(current).removeAttribute("aria-current")
    current = hit
    links.get(hit)?.setAttribute("aria-current", "location")
  }
  let queued = false
  window.addEventListener("scroll", () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; update() })
  }, { passive: true })
  update()

  const rail = document.querySelector(".rail")
  const toggle = document.querySelector(".rail__toggle")
  if (rail && toggle) {
    const set = (open) => {
      rail.classList.toggle("is-open", open)
      toggle.setAttribute("aria-expanded", String(open))
      toggle.querySelector("span").textContent = open ? "목차 닫기" : "목차"
    }
    toggle.addEventListener("click", () => set(!rail.classList.contains("is-open")))
    toc.addEventListener("click", (e) => { if (e.target.closest("a")) set(false) })
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && rail.classList.contains("is-open")) { set(false); toggle.focus() }
    })
  }
}

// 5. 소개 페이지 첫 방문 인트로: 워드마크의 conn 라벨이 nn만 품고 심볼이 된다.
//    같은 세션에서는 한 번만, 움직임 줄이기 설정이면 재생하지 않는다. 클릭·Esc·건너뛰기로 바로 닫힌다.
if (document.body.classList.contains("landing")) {
  const SEEN = "conntext:intro-seen"
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches

  async function showIntro() {
    if (document.querySelector(".intro")) return
    const { mountIntro, play, ICON_DONE, ICON_BOX } = await import("/assets/intro.js")
    const box = document.createElement("div")
    box.className = "intro"
    box.innerHTML = `<svg class="intro__stage" preserveAspectRatio="xMidYMid meet" role="img" aria-label="conntext 인트로: 노란 conn 라벨이 nn만 품은 채 줄어들어 Conntext 심볼이 됩니다"></svg>
      <button class="btn btn--quiet btn--sm intro__skip" type="button">건너뛰기</button>`
    document.body.prepend(box)
    document.documentElement.classList.add("intro-open")
    const stage = box.querySelector("svg")
    const intro = mountIntro(stage)
    // 세로 화면: 16:9 장면에서 워드마크와 심볼이 지나가는 가운데 띠만 잘라 크게 보인다.
    if (innerWidth < innerHeight) stage.setAttribute("viewBox", "380 290 1160 500")
    intro.render(0)

    let stop = () => {}
    let fly = null
    let closed = false
    const finish = () => {
      if (closed) return
      closed = true
      stop()
      fly?.getAnimations().forEach((a) => a.cancel())
      fly?.remove()
      box.classList.add("is-leaving")
      document.documentElement.classList.remove("intro-open")
      document.removeEventListener("keydown", onKey)
      setTimeout(() => box.remove(), 260)
      try { sessionStorage.setItem(SEEN, "1") } catch {}
    }
    const onKey = (e) => { if (e.key === "Escape") finish() }
    document.addEventListener("keydown", onKey)
    box.addEventListener("click", finish)

    // 심볼이 완성되면: 같은 자리에 심볼 이미지를 올리고, 잠깐 커졌다가 머리글 자리로 날아가 붙는다.
    const handoff = () => {
      if (closed) return
      const target = document.querySelector(".topbar__mark")
      const m = stage.getScreenCTM()
      if (!target || !m) return finish()
      const from = { x: m.e + m.a * ICON_BOX.x, y: m.f + m.d * ICON_BOX.y, s: m.a * ICON_BOX.size }
      const to = target.getBoundingClientRect()
      fly = document.createElement("img")
      fly.className = "intro__fly"
      fly.src = "/assets/brand/mark.svg"
      fly.alt = ""
      Object.assign(fly.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.s}px`, height: `${from.s}px` })
      document.body.append(fly)
      box.classList.add("is-handoff")
      // 커지는 동안은 배경을 두고, 날아가기 시작할 때 걷어 페이지를 드러낸다.
      setTimeout(() => box.classList.add("is-revealing"), 280)
      const k = to.width / from.s
      const dx = to.left - from.x, dy = to.top - from.y
      const grow = 1.12, c = (from.s * (1 - grow)) / 2   // 가운데를 기준으로 커지게
      const anim = fly.animate([
        { transform: "translate(0px, 0px) scale(1)", offset: 0, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
        { transform: `translate(${c}px, ${c}px) scale(${grow})`, offset: 0.3, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, offset: 1 },
      ], { duration: 980, fill: "forwards" })
      anim.finished.then(finish, () => {})
    }
    stop = play(intro.render, { rate: 1.4, until: ICON_DONE, onDone: () => setTimeout(handoff, 120) })
  }

  let seen = false
  try { seen = sessionStorage.getItem(SEEN) === "1" } catch {}
  if (!reduce && !seen && !location.hash) showIntro()
  document.querySelector("[data-intro]")?.addEventListener("click", () => { if (reduce) return; scrollTo({ top: 0 }); showIntro() })
  if (reduce) document.querySelector("[data-intro]")?.setAttribute("hidden", "")
}
