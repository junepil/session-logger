import {
  copyFileSync, existsSync, mkdirSync, readFileSync,
  renameSync, writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"
import { randomBytes } from "node:crypto"

export const OBSIDIAN_JSON_PATH = join(
  process.env.HOME ?? "",
  "Library/Application Support/obsidian/obsidian.json",
)

type VaultEntry = {
  path: string
  ts: number
  open?: boolean
}

export type ObsidianConfig = {
  vaults?: Record<string, VaultEntry>
  [k: string]: unknown
}

export type VaultResolution =
  | { kind: "existing"; path: string }
  | { kind: "created"; path: string }

export type ResolveDeps = {
  configPath?: string
  homeDir?: string
  randomId?: () => string
  now?: () => number
}

export function validateVaultName(name: string): string | null {
  if (name.length === 0 || name.trim().length === 0) {
    return "Vault name is required"
  }
  if (name.trim() !== name) {
    return "Vault name cannot have leading/trailing whitespace"
  }
  if (name.includes("/") || name.includes("\\")) {
    return "Vault name cannot contain '/' or '\\'"
  }
  if (name.includes("'")) {
    return "Vault name cannot contain a single quote"
  }
  return null
}

export function findVaultByName(
  config: ObsidianConfig,
  name: string,
): string | null {
  const vaults = config.vaults ?? {}
  for (const entry of Object.values(vaults)) {
    if (basename(entry.path) === name) return entry.path
  }
  return null
}

export function resolveVault(
  name: string,
  deps: ResolveDeps = {},
): VaultResolution {
  const configPath = deps.configPath ?? OBSIDIAN_JSON_PATH
  const homeDir = deps.homeDir ?? process.env.HOME ?? ""
  const randomId =
    deps.randomId ?? (() => randomBytes(8).toString("hex"))
  const now = deps.now ?? (() => Date.now())

  if (!existsSync(configPath)) {
    throw new Error(
      "Obsidian app must be installed and run at least once before this installer can register a new vault.",
    )
  }

  const raw = readFileSync(configPath, "utf8")
  const config: ObsidianConfig = JSON.parse(raw)

  const existing = findVaultByName(config, name)
  if (existing) return { kind: "existing", path: existing }

  const target = join(homeDir, "Documents", name)
  if (existsSync(target)) {
    throw new Error(
      `${target} already exists. Pick a different vault name.`,
    )
  }

  copyFileSync(configPath, `${configPath}.bak-${now()}`)

  mkdirSync(join(target, ".obsidian"), { recursive: true })

  const updated: ObsidianConfig = { ...config }
  updated.vaults = { ...(config.vaults ?? {}) }
  updated.vaults[randomId()] = {
    path: target,
    ts: now(),
    open: false,
  }

  const tmp = `${configPath}.tmp`
  writeFileSync(tmp, JSON.stringify(updated))
  renameSync(tmp, configPath)

  return { kind: "created", path: target }
}
