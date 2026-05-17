import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadDotEnv } from "../parsers.ts"

export type EnvValues = {
  OBSIDIAN_VAULT: string
  LEARNING_STACKS: string
  LEARNING_DOMAINS: string
}

const ENV_KEYS: (keyof EnvValues)[] = [
  "OBSIDIAN_VAULT",
  "LEARNING_STACKS",
  "LEARNING_DOMAINS",
]

export function readEnvDefaults(repoDir: string): EnvValues {
  const blank: EnvValues = {
    OBSIDIAN_VAULT: "",
    LEARNING_STACKS: "",
    LEARNING_DOMAINS: "",
  }
  const path = join(repoDir, ".env")
  if (!existsSync(path)) return blank
  const parsed = loadDotEnv(readFileSync(path, "utf8"))
  return {
    OBSIDIAN_VAULT: parsed.OBSIDIAN_VAULT ?? "",
    LEARNING_STACKS: parsed.LEARNING_STACKS ?? "",
    LEARNING_DOMAINS: parsed.LEARNING_DOMAINS ?? "",
  }
}

export function validateEnvValue(val: string): string | null {
  if (val.includes("'")) {
    return "Value cannot contain a single quote"
  }
  return null
}

function formatLine(key: string, val: string): string {
  if (val.length === 0) return `${key}=`
  return `${key}='${val}'`
}

export function writeEnv(repoDir: string, values: EnvValues): void {
  for (const k of ENV_KEYS) {
    const err = validateEnvValue(values[k])
    if (err) throw new Error(`${k}: ${err}: ${values[k]}`)
  }
  const lines = [
    "# Obsidian vault to write journal and concept notes into.",
    "# Set by the installer. Re-run scripts/bootstrap.ts to change.",
    formatLine("OBSIDIAN_VAULT", values.OBSIDIAN_VAULT),
    "",
    "# Comma-separated tech stacks you want to learn (e.g. \"Spring Boot, Kotlin, AWS\").",
    "# Concept extraction will focus on these stacks. Leave empty to capture all.",
    formatLine("LEARNING_STACKS", values.LEARNING_STACKS),
    "",
    "# Comma-separated project domains you want to learn (e.g. \"Ads, Customer Data Platform\").",
    "# Concept extraction will focus on these domains. Leave empty to capture all.",
    formatLine("LEARNING_DOMAINS", values.LEARNING_DOMAINS),
    "",
  ]
  const tmp = join(repoDir, ".env.tmp")
  const final = join(repoDir, ".env")
  writeFileSync(tmp, lines.join("\n"))
  renameSync(tmp, final)
}
