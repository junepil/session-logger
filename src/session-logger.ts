import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
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
