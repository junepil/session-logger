import { readFileSync, existsSync, readdirSync, statSync, realpathSync, appendFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { dirname } from "node:path"
import { homedir } from "node:os"
import { join } from "node:path"

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

const BUN_PATH = "/Users/junepil.lee/.bun/bin/bun"
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

if (import.meta.main) {
  if (Bun.argv.includes("--worker")) {
    const sid = getArg("--session-id")
    if (!sid) {
      appendErrorLog("worker.entry", "missing --session-id")
      process.exit(0)
    }
    // runWorker added in later task — for now exit
    process.exit(0)
  } else {
    await runParent(await Bun.stdin.text())
    process.exit(0)
  }
}
