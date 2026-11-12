// Conntext OpenCode 플러그인.
// 세션의 시스템 프롬프트에 Conntext 맥락을 넣고, 세션이 한가해지면 대화를 서버로 보낸다.
// 실제 통신은 Claude Code와 같은 클라이언트(~/.conntext/bin/conntext.py)가 맡는다.
//
// OpenCode에는 세션 종료 이벤트가 없고, 프로세스가 끝날 때 이 플러그인의 타이머나 dispose도
// 믿을 수 없다(`opencode run`에서는 둘 다 실행되지 않았다). 그래서 session.idle마다 대화 스냅샷을
// 쓰고, OpenCode와 분리된 대기 프로세스(`conntext.py upload <marker> --after N --pid P`)를 띄운다.
// 대기 프로세스는 OpenCode 프로세스가 끝나면 곧바로, 살아 있으면 스냅샷이 N초 동안 그대로일 때 올린다.
// 세션마다 대기 프로세스는 하나만 남고(파일 잠금), 나머지는 바로 끝난다.
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdir, writeFile, rename, rm } from "node:fs/promises"

const HOME = process.env.CONNTEXT_HOME || join(homedir(), ".conntext")
const CLIENT = join(HOME, "bin", "conntext.py")
const PENDING = join(HOME, "pending")
// OpenCode를 켜 둔 채 쉬고 있을 때, 마지막 응답 뒤 이만큼 조용하면 끝난 것으로 보고 올린다.
// 업로드마다 서버가 추출(LLM 호출)을 한 번 하므로 너무 짧게 잡지 않는다. OpenCode를 끄면 기다리지 않는다.
const IDLE_UPLOAD_SECONDS = Number(process.env.CONNTEXT_IDLE_UPLOAD_SECONDS) || 300
const ENV = { ...process.env, CONNTEXT_PLATFORM: "opencode" }

function run(args, input, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let out = ""
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      const p = spawn("python3", [CLIENT, ...args], { env: ENV, stdio: ["pipe", "pipe", "ignore"] })
      const timer = setTimeout(() => { p.kill(); finish("") }, timeoutMs)
      p.stdout.on("data", (d) => { out += d })
      p.on("error", () => { clearTimeout(timer); finish("") })
      p.on("close", () => { clearTimeout(timer); finish(out) })
      p.stdin.end(input || "")
    } catch {
      finish("")
    }
  })
}

function detached(args) {
  try {
    spawn("python3", [CLIENT, ...args], { env: ENV, stdio: "ignore", detached: true }).unref()
  } catch {}
}

const marker = (id) => join(PENDING, id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) + ".json")

export const Conntext = async ({ client, directory }) => {
  const contexts = new Map()   // sessionID → Promise<string>
  const children = new Set()   // 하위 에이전트 세션은 기록하지 않는다

  const context = (sessionID) => {
    if (!contexts.has(sessionID)) {
      contexts.set(sessionID, run(["hook", "session-start"], JSON.stringify({ session_id: sessionID, cwd: directory, source: "startup" })).then((out) => {
        try { return JSON.parse(out).hookSpecificOutput.additionalContext || "" } catch { return "" }
      }))
    }
    return contexts.get(sessionID)
  }

  const snapshot = async (sessionID) => {
    const res = await client.session.messages({ path: { id: sessionID } })
    const messages = []
    for (const m of res?.data || []) {
      const text = []
      const tools = []
      for (const part of m.parts || []) {
        if (part.type === "text" && !part.synthetic && part.text) text.push(part.text)
        if (part.type === "tool") {
          const i = part.state?.input || {}
          tools.push(`${part.tool}: ${String(i.command || i.filePath || i.pattern || i.description || "").slice(0, 120)}`)
        }
      }
      if (text.length || tools.length) messages.push({ role: m.info?.role === "user" ? "user" : "assistant", text: text.join("\n"), tools })
    }
    if (!messages.length) return false
    await mkdir(PENDING, { recursive: true })
    // 대기 프로세스가 반쯤 쓰인 파일을 읽지 않도록 임시 파일에 쓰고 바꿔 넣는다.
    const tmp = marker(sessionID) + "." + process.pid + ".tmp"
    await writeFile(tmp, JSON.stringify({ session_id: sessionID, cwd: directory, platform: "opencode", pid: process.pid, messages }))
    await rename(tmp, marker(sessionID))
    return true
  }

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID || children.has(input.sessionID)) return
      const text = await context(input.sessionID)
      if (text) output.system.push(text)
    },
    event: async ({ event }) => {
      try {
        const p = event.properties || {}
        if (event.type === "session.created" && p.info?.parentID) children.add(p.info.id)
        const id = p.sessionID
        if (!id || children.has(id)) return
        if (event.type === "session.idle") {
          // 대기 프로세스를 스냅샷보다 먼저 띄운다. 스냅샷을 쓰는 사이 OpenCode가 끝나도 대기 프로세스는 남는다.
          // 이미 이 세션을 기다리는 프로세스가 있으면 새로 띄운 쪽은 바로 끝난다.
          detached(["upload", marker(id), "--after", String(IDLE_UPLOAD_SECONDS), "--pid", String(process.pid)])
          await snapshot(id)
        } else if (event.type === "session.compacted") {
          if (await snapshot(id)) detached(["upload", marker(id), "--checkpoint"])
        } else if (event.type === "session.deleted") {
          await rm(marker(id), { force: true })
        }
      } catch {}
    },
  }
}
