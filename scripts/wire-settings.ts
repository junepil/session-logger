import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from "node:fs"
import { join } from "node:path"
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
  // settings.json is plain JSON — no Dates, functions, undefined, or cycles.
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

function shQuote(s: string): string {
  // Bash single quotes are literal; embed a single quote via close-escape-open trick.
  return `'${s.replace(/'/g, "'\\''")}'`
}

function hasCommand(current: unknown, cmd: string): boolean {
  if (!isPlainObject(current)) return false
  const hooks = (current as any).hooks
  if (!isPlainObject(hooks)) return false
  const sessionEnd = (hooks as any).SessionEnd
  if (!Array.isArray(sessionEnd)) return false
  for (const group of sessionEnd) {
    if (!isPlainObject(group)) continue
    const groupHooks = (group as any).hooks
    if (!Array.isArray(groupHooks)) continue
    for (const h of groupHooks) {
      if (isPlainObject(h) && (h as any).type === "command" && (h as any).command === cmd) {
        return true
      }
    }
  }
  return false
}

export function removeCommand(
  current: unknown,
  exactCommand: string,
): { result: object; removed: boolean } {
  const result = deepClone(current) as object
  if (!isPlainObject(result)) return { result, removed: false }
  const hooks = (result as any).hooks
  if (!isPlainObject(hooks)) return { result, removed: false }
  const sessionEnd = (hooks as any).SessionEnd
  if (!Array.isArray(sessionEnd)) return { result, removed: false }
  let removed = false
  for (const group of sessionEnd) {
    if (!isPlainObject(group)) continue
    const groupHooks = (group as any).hooks
    if (!Array.isArray(groupHooks)) continue
    const filtered = groupHooks.filter((h) => {
      const match =
        isPlainObject(h) &&
        (h as any).type === "command" &&
        (h as any).command === exactCommand
      if (match) removed = true
      return !match
    })
    ;(group as any).hooks = filtered
  }
  return { result, removed }
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
        throw new Error("settings.hooks.SessionEnd[].hooks must be an array")
      }
      ;(g.hooks as unknown[]).push(entry)
      return { result, status: "appended" }
    }
  }

  // Else push a new no-matcher group at the end
  sessionEnd.push({ hooks: [entry] })
  return { result, status: "pushed-group" }
}

function parseArgs(argv: string[]): { bun?: string; script?: string; removeLegacy?: string } {
  const out: { bun?: string; script?: string; removeLegacy?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--bun") {
      out.bun = argv[++i]
    } else if (a === "--script") {
      out.script = argv[++i]
    } else if (a === "--remove-legacy") {
      out.removeLegacy = argv[++i]
    }
  }
  return out
}

function printUsage(): void {
  console.error(
    "Usage: wire-settings.ts --bun <bun-binary-path> --script <hook-entry-script-path> [--remove-legacy <exact-command>]",
  )
}

if (import.meta.main) {
  const args = parseArgs(Bun.argv.slice(2))
  if (!args.bun || !args.script) {
    printUsage()
    process.exit(2)
  }
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

  // One-shot legacy removal pass: strip any entry whose .command exactly matches
  // the provided --remove-legacy string before the normal merge proceeds.
  let removedLegacy = false
  if (args.removeLegacy && current) {
    const { result: stripped, removed } = removeCommand(current, args.removeLegacy)
    if (removed) {
      current = stripped
      removedLegacy = true
      console.log("Wire-settings: removed legacy entry from ~/.claude/settings.json")
    }
  }

  // Before calling mergeHook, check whether the unquoted form is already present in the file.
  // If so, use that as the entry so mergeHook reports "already-wired" without changes.
  const quotedCommand = `${shQuote(args.bun)} ${shQuote(args.script)}`
  const legacyCommand = `${args.bun} ${args.script}`
  const entry: HookEntry = { type: "command", command: quotedCommand }

  if (current && hasCommand(current, legacyCommand)) {
    // Legacy unquoted entry exists; treat as already-wired by passing the legacy form.
    // mergeHook will see it matches and return "already-wired".
    entry.command = legacyCommand
  }

  const { result, status } = mergeHook(current, entry)

  if (status === "already-wired" && !removedLegacy) {
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
