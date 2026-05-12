import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

export type HookEntry = { type: "command"; command: string }
export type MergeResult = {
  result: object
  status: "created" | "appended" | "pushed-group" | "already-wired"
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function hasEntry(group: unknown, entry: HookEntry): boolean {
  if (!isPlainObject(group)) return false
  const hooks = (group as any).hooks
  if (!Array.isArray(hooks)) return false
  for (const h of hooks) {
    if (isPlainObject(h) && h.type === "command" && h.command === entry.command) {
      return true
    }
  }
  return false
}

export function mergeHook(current: unknown, entry: HookEntry): MergeResult {
  if (current === null || current === undefined) {
    return {
      result: { hooks: { SessionEnd: [{ hooks: [entry] }] } },
      status: "created",
    }
  }
  if (!isPlainObject(current)) {
    throw new Error("settings.json root must be a JSON object")
  }

  const result = deepClone(current) as Record<string, unknown>

  if (result.hooks === undefined) {
    result.hooks = { SessionEnd: [{ hooks: [entry] }] }
    return { result, status: "created" }
  }
  if (!isPlainObject(result.hooks)) {
    throw new Error("settings.hooks must be an object")
  }

  const hooks = result.hooks as Record<string, unknown>

  if (hooks.SessionEnd === undefined) {
    hooks.SessionEnd = [{ hooks: [entry] }]
    return { result, status: "created" }
  }
  if (!Array.isArray(hooks.SessionEnd)) {
    throw new Error("settings.hooks.SessionEnd must be an array")
  }

  const sessionEnd = hooks.SessionEnd as unknown[]

  // Idempotency check
  for (const group of sessionEnd) {
    if (hasEntry(group, entry)) {
      return { result, status: "already-wired" }
    }
  }

  // Find first no-matcher group
  for (const group of sessionEnd) {
    if (isPlainObject(group) && !("matcher" in group)) {
      const g = group as Record<string, unknown>
      if (!Array.isArray(g.hooks)) {
        g.hooks = []
      }
      ;(g.hooks as unknown[]).push(entry)
      return { result, status: "appended" }
    }
  }

  // Else push a new no-matcher group at the end
  sessionEnd.push({ hooks: [entry] })
  return { result, status: "pushed-group" }
}

function parseArgs(argv: string[]): { bun?: string; script?: string } {
  const out: { bun?: string; script?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--bun") {
      out.bun = argv[++i]
    } else if (a === "--script") {
      out.script = argv[++i]
    }
  }
  return out
}

function printUsage(): void {
  console.error("Usage: wire-settings.ts --bun <bun-binary-path> --script <hook-entry-script-path>")
}

if (import.meta.main) {
  const args = parseArgs(Bun.argv.slice(2))
  if (!args.bun || !args.script) {
    printUsage()
    process.exit(2)
  }
  const entry: HookEntry = { type: "command", command: `${args.bun} ${args.script}` }
  const claudeDir = join(homedir(), ".claude")
  const settingsPath = join(claudeDir, "settings.json")

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  let current: unknown = null
  let fileExisted = false
  if (existsSync(settingsPath)) {
    fileExisted = true
    const raw = readFileSync(settingsPath, "utf8")
    try {
      current = raw.trim().length === 0 ? null : JSON.parse(raw)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`Failed to parse ${settingsPath}: ${msg}`)
      process.exit(1)
    }
  }

  const { result, status } = mergeHook(current, entry)

  if (status === "already-wired") {
    console.log("SessionEnd hook already present in ~/.claude/settings.json — nothing to do.")
    process.exit(0)
  }

  let backupPath: string | null = null
  if (fileExisted) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    backupPath = `${settingsPath}.bak.${stamp}`
    copyFileSync(settingsPath, backupPath)
  }

  const tmpPath = `${settingsPath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(result, null, 2) + "\n")
  renameSync(tmpPath, settingsPath)

  const backupMsg = backupPath ? ` (backup: ${backupPath})` : ""
  console.log(`Wire-settings: ${status} ~/.claude/settings.json${backupMsg}`)
}
