import { existsSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { VAULT_DIRS } from "../vault-paths.ts"

export type LayoutResult = {
  created: string[]
  existed: string[]
}

export function ensureVaultLayout(vaultPath: string): LayoutResult {
  const created: string[] = []
  const existed: string[] = []
  for (const dir of VAULT_DIRS) {
    const target = join(vaultPath, dir)
    if (existsSync(target)) {
      if (!statSync(target).isDirectory()) {
        throw new Error(`${target} exists but is not a directory`)
      }
      existed.push(dir)
      continue
    }
    mkdirSync(target, { recursive: true })
    created.push(dir)
  }
  return { created, existed }
}
