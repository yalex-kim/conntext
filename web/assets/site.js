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
