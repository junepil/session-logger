import { readFileSync, realpathSync, appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { loadDotEnv } from "./parsers.ts"

export const BUN_PATH: string = process.env.SESSION_LOGGER_BUN
  || (typeof process.execPath === "string" && process.execPath.length > 0 ? process.execPath : "bun")
export const ERROR_LOG = join(homedir(), ".claude", "hooks", "session-logger.error.log")

// Resolve project root from the script's REAL path (handles symlinks).
// Bun.argv[1] is the path as invoked (often the symlink in ~/.claude/hooks/).
// realpathSync resolves to the actual file in ~/projects/session-logger/src/.
const SCRIPT_REAL_PATH: string = (() => {
  try { return realpathSync(Bun.argv[1] ?? "") } catch { return "" }
})()
export const PROJECT_ROOT: string = SCRIPT_REAL_PATH ? dirname(dirname(SCRIPT_REAL_PATH)) : ""
export const ENV_CONFIG: Record<string, string> = (() => {
  if (!PROJECT_ROOT) return {}
  try {
    return loadDotEnv(readFileSync(join(PROJECT_ROOT, ".env"), "utf8"))
  } catch { return {} }
})()
export const VAULT: string = ENV_CONFIG.OBSIDIAN_VAULT ?? ""
export const PROMPTS_DIR: string = PROJECT_ROOT ? join(PROJECT_ROOT, "prompts") : ""

export function appendErrorLog(stage: string, msg: string): void {
  try {
    appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] [${stage}] ${msg}\n`)
  } catch {}
}
