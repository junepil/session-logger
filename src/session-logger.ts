import { readFileSync, existsSync, readdirSync, statSync, realpathSync, appendFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname, basename, join } from "node:path"
import { homedir } from "node:os"

export function parseHookInput(json: string): { sessionId: string } | null {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed?.session_id === "string" && parsed.session_id.length > 0) {
      return { sessionId: parsed.session_id }
    }
    return null
  } catch {
    return null
  }
}

export function extractTranscript(jsonlPath: string): string {
  if (!existsSync(jsonlPath)) return ""
  const raw = readFileSync(jsonlPath, "utf8")
  const lines = raw.split("\n").filter(l => l.trim().length > 0)
  const items: { ts: string; role: string; text: string }[] = []
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (o.type !== "user" && o.type !== "assistant") continue
      const c = o.message?.content
      let text = ""
      if (typeof c === "string") {
        text = c
      } else if (Array.isArray(c)) {
        text = c
          .filter((x: any) => x?.type === "text" && typeof x.text === "string")
          .map((x: any) => x.text)
          .join(" ")
      }
      if (text.trim().length === 0) continue
      items.push({ ts: o.timestamp ?? "", role: o.type, text })
    } catch {
      continue
    }
  }
  items.sort((a, b) => a.ts.localeCompare(b.ts))
  return items.map(i => `[${i.role}] ${i.text}`).join("\n")
}

export function findJsonlPath(
  sessionId: string,
  projectsRoot: string = join(homedir(), ".claude", "projects"),
): string | null {
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(projectsRoot)
  } catch {
    return null
  }
  for (const dir of projectDirs) {
    const candidate = join(projectsRoot, dir, `${sessionId}.jsonl`)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

export interface Concept {
  filename: string
  title: string
  tags?: string[]
  summary?: string
  details?: string
}

export function parseConcepts(raw: string): Concept[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  let arr: unknown
  try {
    arr = JSON.parse(match[0])
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Concept[] = []
  for (const c of arr) {
    if (
      c && typeof c === "object" &&
      typeof (c as any).filename === "string" &&
      typeof (c as any).title === "string"
    ) {
      out.push(c as Concept)
    }
  }
  return out
}

export function detectDuplicateCreate(cliOutput: string): string | null {
  const m = cliOutput.match(/^Created:\s*(.+ 1\.md)\s*$/m)
  return m ? m[1] : null
}

export function isClaudeKnownError(raw: string): boolean {
  return /^(Not logged in|Error:|Invalid API key|Please run \/login)/i.test(raw.trim())
}

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_, key) => {
    const value = vars[key]?.trim()
    return value && value.length > 0 ? value : "(any)"
  })
}

export function loadDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    env[m[1]] = v
  }
  return env
}

const BUN_PATH: string = process.env.SESSION_LOGGER_BUN
  || (typeof process.execPath === "string" && process.execPath.length > 0 ? process.execPath : "bun")
const ERROR_LOG = join(homedir(), ".claude", "hooks", "session-logger.error.log")

// Resolve project root from the script's REAL path (handles symlinks).
// Bun.argv[1] is the path as invoked (often the symlink in ~/.claude/hooks/).
// realpathSync resolves to the actual file in ~/projects/session-logger/src/.
const SCRIPT_REAL_PATH: string = (() => {
  try { return realpathSync(Bun.argv[1] ?? "") } catch { return "" }
})()
const PROJECT_ROOT: string = SCRIPT_REAL_PATH ? dirname(dirname(SCRIPT_REAL_PATH)) : ""
const ENV_CONFIG: Record<string, string> = (() => {
  if (!PROJECT_ROOT) return {}
  try {
    return loadDotEnv(readFileSync(join(PROJECT_ROOT, ".env"), "utf8"))
  } catch { return {} }
})()
const VAULT: string = ENV_CONFIG.OBSIDIAN_VAULT ?? ""
const PROMPTS_DIR: string = PROJECT_ROOT ? join(PROJECT_ROOT, "prompts") : ""

function appendErrorLog(stage: string, msg: string): void {
  try {
    appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] [${stage}] ${msg}\n`)
  } catch {}
}

async function runParent(stdin: string): Promise<void> {
  if (process.env.CLAUDE_LTM_RUNNING) return
  const parsed = parseHookInput(stdin)
  if (!parsed) return
  try {
    const child = spawn(
      BUN_PATH,
      [Bun.argv[1], "--worker", "--session-id", parsed.sessionId],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, CLAUDE_LTM_RUNNING: "1" },
      },
    )
    child.unref()
  } catch (e) {
    appendErrorLog("parent.spawn", (e as Error).message)
  }
}

function getArg(name: string): string | null {
  const i = Bun.argv.indexOf(name)
  if (i < 0 || i + 1 >= Bun.argv.length) return null
  return Bun.argv[i + 1]
}

async function invokeClaudePrint(
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const proc = Bun.spawn(["claude", "--print"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    })
    proc.stdin.write(prompt)
    await proc.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      const snippet = (stdout + stderr).replace(/\s+/g, " ").slice(0, 120)
      return { ok: false, reason: `exit=${exitCode}, output=${snippet}` }
    }
    if (isClaudeKnownError(stdout)) {
      return { ok: false, reason: `exit=0, output=${stdout.slice(0, 120)}` }
    }
    return { ok: true, text: stdout.trim() }
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { ok: false, reason: "exit=124, output=(timed out after 120s)" }
    }
    return { ok: false, reason: `exit=?, output=${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

async function obsidianRun(args: string[]): Promise<string> {
  const proc = Bun.spawn(["obsidian", `vault=${VAULT}`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return (stdout + stderr).trim()
}

async function obsidianAppend(path: string, content: string): Promise<boolean> {
  let out = await obsidianRun(["append", `path=${path}`, `content=${content}`])
  if (out.includes("not found")) {
    const date = path.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? ""
    const header =
      `---\ntitle: Journal ${date}\ndate: ${date}\ntype: journal\ntags: [journal, ltm]\n---\n`
    const createOut = await obsidianRun([
      "create", `path=${path}`, `content=${header}`,
    ])
    const dup = detectDuplicateCreate(createOut)
    if (dup) {
      await obsidianRun(["delete", `path=${dup}`, "permanent"])
    }
    out = await obsidianRun(["append", `path=${path}`, `content=${content}`])
  }
  return out.startsWith("Appended")
}

async function obsidianCreate(path: string, content: string): Promise<"created" | "exists" | "failed"> {
  const out = await obsidianRun(["create", `path=${path}`, `content=${content}`])
  const dup = detectDuplicateCreate(out)
  if (dup) {
    await obsidianRun(["delete", `path=${dup}`, "permanent"])
    return "exists"
  }
  if (out.startsWith("Created:")) return "created"
  return "failed"
}

async function isObsidianRunning(): Promise<boolean> {
  const proc = Bun.spawn(["pgrep", "-x", "Obsidian"], { stdout: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}

const SUMMARY_PROMPT_PATH = join(PROMPTS_DIR, "session-summary.md")
const CONCEPTS_PROMPT_PATH = join(PROMPTS_DIR, "session-concepts.md")

function loadPromptOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function formatJournalEntry(time: string, cwdName: string, body: string): string {
  return `\n## [${time} | ${cwdName}]\n\n${body}\n`
}

function todayInSeoul(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

async function runWorker(sessionId: string): Promise<void> {
  if (!VAULT) {
    appendErrorLog("worker.config", "OBSIDIAN_VAULT not set in .env (expected at " + join(PROJECT_ROOT, ".env") + ")")
    return
  }

  await Bun.sleep(3000)

  if (!(await isObsidianRunning())) {
    console.error("Obsidian not running, skipping session log")
    return
  }

  const jsonl = findJsonlPath(sessionId)
  if (!jsonl) {
    console.error(`JSONL not found for session ${sessionId}`)
    return
  }

  const transcript = extractTranscript(jsonl)
  if (transcript.length === 0) {
    console.error(`Transcript empty for session ${sessionId}`)
    return
  }

  const { date, time } = todayInSeoul()
  const cwdName = basename(process.cwd())
  const journalPath = `journal/${date}.md`

  const summaryPrompt = loadPromptOrNull(SUMMARY_PROMPT_PATH)
  if (summaryPrompt === null) {
    await obsidianAppend(
      journalPath,
      formatJournalEntry(time, cwdName, `(prompt file missing: ${SUMMARY_PROMPT_PATH})`),
    )
    return
  }

  const summaryResult = await invokeClaudePrint(`${summaryPrompt}\n\n${transcript}`)
  const summaryBody = summaryResult.ok ? summaryResult.text : `(요약 실패 - ${summaryResult.reason})`
  await obsidianAppend(journalPath, formatJournalEntry(time, cwdName, summaryBody))

  const conceptsPrompt = loadPromptOrNull(CONCEPTS_PROMPT_PATH)
  if (conceptsPrompt === null) {
    await obsidianAppend(
      journalPath,
      formatJournalEntry(time, cwdName, `(prompt file missing: ${CONCEPTS_PROMPT_PATH})`),
    )
    return
  }

  const renderedConcepts = renderPrompt(conceptsPrompt, {
    LEARNING_STACKS: ENV_CONFIG.LEARNING_STACKS ?? "",
    LEARNING_DOMAINS: ENV_CONFIG.LEARNING_DOMAINS ?? "",
  })
  const conceptsResult = await invokeClaudePrint(`${renderedConcepts}\n\n${transcript}`)
  if (!conceptsResult.ok) {
    appendErrorLog("worker.concepts", conceptsResult.reason)
    return
  }
  const concepts = parseConcepts(conceptsResult.text)
  for (const c of concepts) {
    const tags = (c.tags ?? []).join(", ")
    const content =
      `---\ntitle: ${c.title}\ndate: ${date}\ntype: concept\ntags: [${tags}]\n---\n\n` +
      `## Summary\n${c.summary ?? ""}\n\n` +
      `## Details\n${c.details ?? ""}\n`
    const result = await obsidianCreate(`concepts/${c.filename}`, content)
    if (result === "failed") {
      appendErrorLog("worker.concept.create", `failed: ${c.filename}`)
    }
  }
}

if (import.meta.main) {
  if (Bun.argv.includes("--worker")) {
    const sid = getArg("--session-id")
    if (!sid) {
      appendErrorLog("worker.entry", "missing --session-id")
      process.exit(0)
    }
    try {
      await runWorker(sid)
    } catch (e) {
      appendErrorLog("worker.uncaught", (e as Error).stack ?? String(e))
    }
    process.exit(0)
  } else {
    await runParent(await Bun.stdin.text())
    process.exit(0)
  }
}
