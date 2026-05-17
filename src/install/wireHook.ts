import {
  existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync,
} from "node:fs"
import { join } from "node:path"

export async function buildBundle(repoDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: repoDir,
    stdout: "inherit",
    stderr: "inherit",
  })
  await proc.exited
  if (proc.exitCode !== 0) {
    throw new Error(`build failed (exit ${proc.exitCode})`)
  }
}

export type SymlinkPaths = {
  newScript: string
  legacyScript: string
}

export function ensureSymlink(
  repoDir: string,
  hooksDir: string,
): SymlinkPaths {
  mkdirSync(hooksDir, { recursive: true })

  const legacyScript = join(hooksDir, "session-logger.ts")
  if (existsSync(legacyScript)) {
    try {
      if (lstatSync(legacyScript).isSymbolicLink()) {
        unlinkSync(legacyScript)
      }
    } catch {
      // ignore — non-symlink files are left alone
    }
  }

  const newScript = join(hooksDir, "session-logger.js")
  const bundle = join(repoDir, "dist", "session-logger.js")
  if (existsSync(newScript)) {
    try {
      unlinkSync(newScript)
    } catch {
      // ignore — caller will see the symlink call fail if this matters
    }
  }
  symlinkSync(bundle, newScript)

  return { newScript, legacyScript }
}

export async function wireSettings(
  repoDir: string,
  bunPath: string,
  paths: SymlinkPaths,
): Promise<void> {
  const proc = Bun.spawn(
    [
      bunPath,
      "run",
      join(repoDir, "scripts/wire-settings.ts"),
      "--bun", bunPath,
      "--script", paths.newScript,
      "--legacy-bun", bunPath,
      "--legacy-script", paths.legacyScript,
    ],
    { stdout: "inherit", stderr: "inherit" },
  )
  await proc.exited
  if (proc.exitCode !== 0) {
    throw new Error(`wire-settings failed (exit ${proc.exitCode})`)
  }
}
