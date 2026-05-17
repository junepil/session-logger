#!/usr/bin/env bun
import * as p from "@clack/prompts"
import { join } from "node:path"
import { checkObsidianCli } from "../src/install/preflight.ts"
import {
  resolveVault, validateVaultName,
} from "../src/install/obsidianVault.ts"
import { ensureVaultLayout } from "../src/install/vaultLayout.ts"
import {
  readEnvDefaults, validateEnvValue, writeEnv,
} from "../src/install/envFile.ts"
import {
  buildBundle, ensureSymlink, wireSettings,
} from "../src/install/wireHook.ts"

const REPO = process.cwd()
const HOOKS_DIR = join(process.env.HOME ?? "", ".claude", "hooks")

function bail(msg: string): never {
  p.cancel(msg)
  process.exit(1)
}

async function main(): Promise<void> {
  p.intro("session-logger installer")

  const pf = checkObsidianCli()
  if (!pf.ok) bail(pf.message)

  const defaults = readEnvDefaults(REPO)

  const vaultRaw = await p.text({
    message: "Obsidian vault name",
    placeholder: defaults.OBSIDIAN_VAULT || "my-vault",
    defaultValue: defaults.OBSIDIAN_VAULT,
    validate: (val) => validateVaultName(val ?? "") ?? undefined,
  })
  if (p.isCancel(vaultRaw)) bail("Aborted.")
  const vaultName = (vaultRaw as string).trim()

  const spinner = p.spinner()
  spinner.start("Resolving Obsidian vault…")
  let resolution
  try {
    resolution = resolveVault(vaultName)
  } catch (err) {
    spinner.stop("Vault resolution failed.")
    bail((err as Error).message)
  }
  spinner.stop(
    resolution.kind === "created"
      ? `Created vault at ${resolution.path}`
      : `Using existing vault at ${resolution.path}`,
  )

  try {
    const layout = ensureVaultLayout(resolution.path)
    if (layout.created.length > 0) {
      p.log.success(
        `Created ${layout.created.join(", ")}/ inside vault.`,
      )
    }
  } catch (err) {
    bail((err as Error).message)
  }

  const stacks = await p.text({
    message: "Tech stacks to focus on (comma-separated, optional)",
    placeholder: defaults.LEARNING_STACKS || "Spring Boot, Kotlin, AWS",
    defaultValue: defaults.LEARNING_STACKS,
    validate: (val) => validateEnvValue(val ?? "") ?? undefined,
  })
  if (p.isCancel(stacks)) bail("Aborted.")

  const domains = await p.text({
    message: "Project domains to focus on (comma-separated, optional)",
    placeholder:
      defaults.LEARNING_DOMAINS || "Ads, Customer Data Platform",
    defaultValue: defaults.LEARNING_DOMAINS,
    validate: (val) => validateEnvValue(val ?? "") ?? undefined,
  })
  if (p.isCancel(domains)) bail("Aborted.")

  try {
    writeEnv(REPO, {
      OBSIDIAN_VAULT: vaultName,
      LEARNING_STACKS: stacks as string,
      LEARNING_DOMAINS: domains as string,
    })
  } catch (err) {
    bail((err as Error).message)
  }
  p.log.success("Wrote .env")

  spinner.start("Building bundle…")
  try {
    await buildBundle(REPO)
    spinner.stop("Built dist/session-logger.js")
  } catch (err) {
    spinner.stop("Build failed.")
    bail((err as Error).message)
  }

  let symlinkPaths
  try {
    symlinkPaths = ensureSymlink(REPO, HOOKS_DIR)
    p.log.success(`Symlinked ${symlinkPaths.newScript}`)
  } catch (err) {
    bail((err as Error).message)
  }

  spinner.start("Wiring SessionEnd hook into settings.json…")
  try {
    const bunPath = Bun.which("bun") ?? "bun"
    await wireSettings(REPO, bunPath, symlinkPaths)
    spinner.stop("Wired SessionEnd hook.")
  } catch (err) {
    spinner.stop("Wire-settings failed.")
    bail((err as Error).message)
  }

  p.outro(
    resolution.kind === "created"
      ? `Install complete. Restart Obsidian to see vault "${vaultName}".`
      : "Install complete.",
  )
}

main().catch((err) => {
  p.cancel(`Unexpected error: ${(err as Error).message}`)
  process.exit(1)
})
