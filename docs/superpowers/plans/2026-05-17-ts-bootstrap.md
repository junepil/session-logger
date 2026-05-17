# TS Bootstrap & Vault Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `bootstrap.sh` + `install.sh` with a TypeScript installer that uses `@clack/prompts` for a smooth TUI, auto-creates Obsidian vaults when missing, pre-provisions `journal/`/`concepts/` inside the vault, and migrates references to the official Obsidian CLI.

**Architecture:** A ~30-line `bootstrap.sh` shim handles only `git`/`bun` preflight + clone + `bun install`, then exec's `bun run scripts/bootstrap.ts`. The TS orchestrator drives clack prompts and delegates to small single-purpose modules under `src/install/`. macOS-only.

**Tech Stack:** Bun, TypeScript, `@clack/prompts`, `node:fs`, `node:crypto`. Existing `scripts/wire-settings.ts` is reused unchanged. Tests use `bun:test` with `mkdtempSync` for filesystem isolation.

**Spec:** `docs/superpowers/specs/2026-05-17-ts-bootstrap-design.md`

---

## Task 1: Add @clack/prompts dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add @clack/prompts to dependencies**

Edit `package.json` to add a `dependencies` block:

```json
{
  "name": "session-logger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun build src/index.ts --target=bun --outdir=dist --entry-naming=session-logger.js --sourcemap=linked",
    "test": "bun test",
    "start": "bun src/index.ts"
  },
  "dependencies": {
    "@clack/prompts": "^0.7.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "latest"
  }
}
```

- [ ] **Step 2: Install dependency**

Run: `bun install`
Expected: `bun.lock` updated, `@clack/prompts` and its transitive deps appear in `node_modules/`.

- [ ] **Step 3: Smoke-import the package**

Run: `bun -e "import * as p from '@clack/prompts'; console.log(typeof p.text)"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "build: add @clack/prompts dependency for installer TUI"
```

---

## Task 2: Extract shared vault-path constants

**Files:**
- Create: `src/vault-paths.ts`
- Modify: `src/worker.ts`

- [ ] **Step 1: Create the constants module**

Create `src/vault-paths.ts`:

```ts
// Subdirectories that worker.ts writes into and that the installer
// pre-creates. Single source of truth shared between install-time
// provisioning (src/install/vaultLayout.ts) and runtime (src/worker.ts).
export const VAULT_DIRS = ["journal", "concepts"] as const

export const JOURNAL_DIR = "journal"
export const CONCEPTS_DIR = "concepts"
```

- [ ] **Step 2: Update worker.ts to use the constants**

Edit `src/worker.ts` to import and use `JOURNAL_DIR` / `CONCEPTS_DIR` instead of the inline string literals.

Replace this block in `src/worker.ts`:

```ts
import { basename, join } from "node:path"
import { VAULT, PROJECT_ROOT, PROMPTS_DIR, ENV_CONFIG, appendErrorLog } from "./config.ts"
import { extractTranscript, findJsonlPath, parseConcepts, renderPrompt } from "./parsers.ts"
import { invokeClaudePrint } from "./claude.ts"
import { obsidianAppend, obsidianCreate, isObsidianRunning } from "./obsidian.ts"
```

with:

```ts
import { basename, join } from "node:path"
import { VAULT, PROJECT_ROOT, PROMPTS_DIR, ENV_CONFIG, appendErrorLog } from "./config.ts"
import { extractTranscript, findJsonlPath, parseConcepts, renderPrompt } from "./parsers.ts"
import { invokeClaudePrint } from "./claude.ts"
import { obsidianAppend, obsidianCreate, isObsidianRunning } from "./obsidian.ts"
import { JOURNAL_DIR, CONCEPTS_DIR } from "./vault-paths.ts"
```

Then replace `const journalPath = \`journal/${date}.md\`` with:

```ts
const journalPath = `${JOURNAL_DIR}/${date}.md`
```

And replace `obsidianCreate(\`concepts/${c.filename}\`, content)` with:

```ts
obsidianCreate(`${CONCEPTS_DIR}/${c.filename}`, content)
```

- [ ] **Step 3: Run existing tests to confirm no regression**

Run: `bun test`
Expected: all existing tests pass (`tests/session-logger.test.ts`, `tests/wire-settings.test.ts`).

- [ ] **Step 4: Rebuild and verify the bundle still builds**

Run: `bun run build`
Expected: `dist/session-logger.js` regenerated, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/vault-paths.ts src/worker.ts
git commit -m "refactor: extract VAULT_DIRS into src/vault-paths.ts"
```

---

## Task 3: Implement `src/install/vaultLayout.ts` (TDD)

**Files:**
- Create: `tests/install/vault-layout.test.ts`
- Create: `src/install/vaultLayout.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/install/vault-layout.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureVaultLayout } from "../../src/install/vaultLayout.ts"

function newVault(): string {
  return mkdtempSync(join(tmpdir(), "vault-"))
}

describe("ensureVaultLayout", () => {
  test("creates journal/ and concepts/ in an empty vault", () => {
    const vault = newVault()
    const r = ensureVaultLayout(vault)
    expect(r.created.sort()).toEqual(["concepts", "journal"])
    expect(r.existed).toEqual([])
    expect(statSync(join(vault, "journal")).isDirectory()).toBe(true)
    expect(statSync(join(vault, "concepts")).isDirectory()).toBe(true)
  })

  test("is idempotent when both dirs already exist", () => {
    const vault = newVault()
    mkdirSync(join(vault, "journal"))
    mkdirSync(join(vault, "concepts"))
    const r = ensureVaultLayout(vault)
    expect(r.created).toEqual([])
    expect(r.existed.sort()).toEqual(["concepts", "journal"])
  })

  test("creates only the missing dir, preserving existing files", () => {
    const vault = newVault()
    mkdirSync(join(vault, "journal"))
    writeFileSync(join(vault, "journal", "2026-05-17.md"), "existing")
    const r = ensureVaultLayout(vault)
    expect(r.created).toEqual(["concepts"])
    expect(r.existed).toEqual(["journal"])
    expect(existsSync(join(vault, "journal", "2026-05-17.md"))).toBe(true)
  })

  test("throws when a target name exists as a file (not directory)", () => {
    const vault = newVault()
    writeFileSync(join(vault, "journal"), "oops")
    expect(() => ensureVaultLayout(vault)).toThrow(/not a directory/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/install/vault-layout.test.ts`
Expected: FAIL with "Cannot find module '../../src/install/vaultLayout.ts'" or similar import error.

- [ ] **Step 3: Implement vaultLayout.ts**

Create `src/install/vaultLayout.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/install/vault-layout.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/install/vault-layout.test.ts src/install/vaultLayout.ts
git commit -m "feat(install): vaultLayout module to pre-create journal/concepts dirs"
```

---

## Task 4: Implement `src/install/envFile.ts` (TDD)

**Files:**
- Create: `tests/install/env-file.test.ts`
- Create: `src/install/envFile.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/install/env-file.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readEnvDefaults, validateEnvValue, writeEnv } from "../../src/install/envFile.ts"
import { loadDotEnv } from "../../src/parsers.ts"

function newRepo(): string {
  return mkdtempSync(join(tmpdir(), "repo-"))
}

describe("readEnvDefaults", () => {
  test("returns blank defaults when .env missing", () => {
    const repo = newRepo()
    expect(readEnvDefaults(repo)).toEqual({
      OBSIDIAN_VAULT: "",
      LEARNING_STACKS: "",
      LEARNING_DOMAINS: "",
    })
  })

  test("prefills from existing .env", () => {
    const repo = newRepo()
    writeFileSync(
      join(repo, ".env"),
      "OBSIDIAN_VAULT='my'\nLEARNING_STACKS='a, b'\nLEARNING_DOMAINS=\n",
    )
    expect(readEnvDefaults(repo)).toEqual({
      OBSIDIAN_VAULT: "my",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "",
    })
  })
})

describe("validateEnvValue", () => {
  test("returns null for safe values", () => {
    expect(validateEnvValue("hello world")).toBeNull()
    expect(validateEnvValue("")).toBeNull()
  })
  test("rejects values containing a single quote", () => {
    expect(validateEnvValue("can't")).toMatch(/single quote/)
  })
})

describe("writeEnv", () => {
  test("writes KEY='value' format with atomic rename", () => {
    const repo = newRepo()
    writeEnv(repo, {
      OBSIDIAN_VAULT: "v",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "",
    })
    const content = readFileSync(join(repo, ".env"), "utf8")
    expect(content).toContain("OBSIDIAN_VAULT='v'")
    expect(content).toContain("LEARNING_STACKS='a, b'")
    expect(content).toContain("LEARNING_DOMAINS=")
    expect(existsSync(join(repo, ".env.tmp"))).toBe(false)
  })

  test("throws when a value contains a single quote", () => {
    const repo = newRepo()
    expect(() =>
      writeEnv(repo, {
        OBSIDIAN_VAULT: "can't",
        LEARNING_STACKS: "",
        LEARNING_DOMAINS: "",
      }),
    ).toThrow(/single quote/)
  })

  test("round-trips with loadDotEnv", () => {
    const repo = newRepo()
    const values = {
      OBSIDIAN_VAULT: "vault name",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "X, Y",
    }
    writeEnv(repo, values)
    const parsed = loadDotEnv(readFileSync(join(repo, ".env"), "utf8"))
    expect(parsed.OBSIDIAN_VAULT).toBe(values.OBSIDIAN_VAULT)
    expect(parsed.LEARNING_STACKS).toBe(values.LEARNING_STACKS)
    expect(parsed.LEARNING_DOMAINS).toBe(values.LEARNING_DOMAINS)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/install/env-file.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement envFile.ts**

Create `src/install/envFile.ts`:

```ts
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
    "# Find your vault names with: `obsidian vaults`",
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/install/env-file.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/install/env-file.test.ts src/install/envFile.ts
git commit -m "feat(install): envFile module for round-trip-safe .env r/w"
```

---

## Task 5: Implement `src/install/obsidianVault.ts` (TDD)

**Files:**
- Create: `tests/install/obsidian-vault.test.ts`
- Create: `src/install/obsidianVault.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/install/obsidian-vault.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, existsSync, statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  validateVaultName, findVaultByName, resolveVault,
} from "../../src/install/obsidianVault.ts"

function makeHome(): { home: string; configPath: string } {
  const home = mkdtempSync(join(tmpdir(), "home-"))
  mkdirSync(join(home, "Library", "Application Support", "obsidian"), {
    recursive: true,
  })
  mkdirSync(join(home, "Documents"))
  return {
    home,
    configPath: join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
  }
}

function writeConfig(path: string, body: object) {
  writeFileSync(path, JSON.stringify(body))
}

describe("validateVaultName", () => {
  test.each([[""], ["   "], ["foo/bar"], ["foo\\bar"], ["can't"]])(
    "rejects %j",
    (input) => {
      expect(validateVaultName(input)).not.toBeNull()
    },
  )
  test("accepts plain name", () => {
    expect(validateVaultName("my-vault")).toBeNull()
  })
  test("rejects leading/trailing whitespace", () => {
    expect(validateVaultName(" my")).not.toBeNull()
    expect(validateVaultName("my ")).not.toBeNull()
  })
})

describe("findVaultByName", () => {
  test("matches by basename of path", () => {
    const config = { vaults: { abc: { path: "/x/y/Notes", ts: 1 } } }
    expect(findVaultByName(config, "Notes")).toBe("/x/y/Notes")
  })
  test("returns null when no match", () => {
    expect(findVaultByName({ vaults: {} }, "x")).toBeNull()
    expect(findVaultByName({}, "x")).toBeNull()
  })
})

describe("resolveVault", () => {
  test("returns existing path when name matches", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, {
      vaults: { aaa: { path: "/some/Notes", ts: 1 } },
      cli: true,
    })
    const r = resolveVault("Notes", {
      configPath,
      homeDir: home,
      randomId: () => "0".repeat(16),
      now: () => 999,
    })
    expect(r).toEqual({ kind: "existing", path: "/some/Notes" })
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      vaults: { aaa: { path: "/some/Notes", ts: 1 } },
      cli: true,
    })
  })

  test("creates new vault under ~/Documents and updates config", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { vaults: {}, cli: true })
    const r = resolveVault("my-vault", {
      configPath,
      homeDir: home,
      randomId: () => "1234567890abcdef",
      now: () => 1700000000000,
    })
    expect(r.kind).toBe("created")
    expect(r.path).toBe(join(home, "Documents", "my-vault"))
    expect(
      statSync(join(home, "Documents", "my-vault", ".obsidian")).isDirectory(),
    ).toBe(true)
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults["1234567890abcdef"]).toEqual({
      path: join(home, "Documents", "my-vault"),
      ts: 1700000000000,
      open: false,
    })
    expect(after.cli).toBe(true)
  })

  test("initializes vaults key when missing", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { cli: true })
    const r = resolveVault("fresh", {
      configPath,
      homeDir: home,
      randomId: () => "abcdef0123456789",
      now: () => 1,
    })
    expect(r.kind).toBe("created")
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults["abcdef0123456789"].path).toBe(
      join(home, "Documents", "fresh"),
    )
  })

  test("aborts when target directory already exists", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { vaults: {}, cli: true })
    mkdirSync(join(home, "Documents", "taken"))
    expect(() =>
      resolveVault("taken", {
        configPath,
        homeDir: home,
        randomId: () => "x".repeat(16),
        now: () => 0,
      }),
    ).toThrow(/already exists/)
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      vaults: {},
      cli: true,
    })
  })

  test("throws when obsidian.json is missing", () => {
    const { home, configPath } = makeHome()
    expect(() =>
      resolveVault("any", {
        configPath,
        homeDir: home,
        randomId: () => "x".repeat(16),
        now: () => 0,
      }),
    ).toThrow(/Obsidian app must be installed/)
  })

  test("writes a backup before mutating", () => {
    const { home, configPath } = makeHome()
    const before = {
      vaults: { aaa: { path: "/x/Old", ts: 1 } },
      cli: true,
    }
    writeConfig(configPath, before)
    resolveVault("new", {
      configPath,
      homeDir: home,
      randomId: () => "y".repeat(16),
      now: () => 42,
    })
    const dir = join(home, "Library", "Application Support", "obsidian")
    const baks = readdirSync(dir).filter((f) =>
      f.startsWith("obsidian.json.bak-"),
    )
    expect(baks.length).toBe(1)
    expect(JSON.parse(readFileSync(join(dir, baks[0]), "utf8"))).toEqual(before)
  })

  test("preserves existing vault entries verbatim", () => {
    const { home, configPath } = makeHome()
    const before = {
      vaults: {
        keep1: { path: "/v/Alpha", ts: 100, open: true },
        keep2: { path: "/v/Beta", ts: 200 },
      },
      cli: true,
      extraField: "preserved",
    }
    writeConfig(configPath, before)
    resolveVault("Gamma", {
      configPath,
      homeDir: home,
      randomId: () => "z".repeat(16),
      now: () => 500,
    })
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults.keep1).toEqual({
      path: "/v/Alpha",
      ts: 100,
      open: true,
    })
    expect(after.vaults.keep2).toEqual({ path: "/v/Beta", ts: 200 })
    expect(after.extraField).toBe("preserved")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/install/obsidian-vault.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement obsidianVault.ts**

Create `src/install/obsidianVault.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/install/obsidian-vault.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/install/obsidian-vault.test.ts src/install/obsidianVault.ts
git commit -m "feat(install): obsidianVault module — find or auto-create vault"
```

---

## Task 6: Implement `src/install/preflight.ts`

**Files:**
- Create: `src/install/preflight.ts`

No unit test — this is a thin wrapper around `Bun.which`. Behavior is verified at orchestrator level via manual smoke test (Task 9).

- [ ] **Step 1: Create preflight.ts**

Create `src/install/preflight.ts`:

```ts
export type PreflightResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

const OBSIDIAN_CLI_MISSING_MESSAGE =
  "Obsidian CLI not found on PATH.\n\n" +
  "Enable it via Obsidian 1.12.7+:\n" +
  "  Settings → General → \"Command line interface\"\n\n" +
  "See https://obsidian.md/help/cli#Install+Obsidian+CLI"

export function checkObsidianCli(): PreflightResult {
  const bin = Bun.which("obsidian")
  if (!bin) {
    return { ok: false, message: OBSIDIAN_CLI_MISSING_MESSAGE }
  }
  return { ok: true, path: bin }
}
```

- [ ] **Step 2: Smoke-import**

Run: `bun -e "import('./src/install/preflight.ts').then(m => console.log(m.checkObsidianCli()))"`
Expected: object with `ok: true, path: "/opt/homebrew/bin/obsidian"` (on the dev machine which has Yakitrak installed) OR `ok: false, message: ...`. Either is acceptable — we are just verifying the module loads.

- [ ] **Step 3: Commit**

```bash
git add src/install/preflight.ts
git commit -m "feat(install): preflight check for Obsidian CLI on PATH"
```

---

## Task 7: Implement `src/install/wireHook.ts`

**Files:**
- Create: `src/install/wireHook.ts`

No unit test — this orchestrates external processes (`bun run build`, `bun run scripts/wire-settings.ts`) and filesystem symlinks. Verified by manual smoke test (Task 9). The wire-settings.ts logic itself is already covered by `tests/wire-settings.test.ts`.

- [ ] **Step 1: Create wireHook.ts**

Create `src/install/wireHook.ts`:

```ts
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
```

- [ ] **Step 2: Smoke-import**

Run: `bun -e "import('./src/install/wireHook.ts').then(m => console.log(Object.keys(m)))"`
Expected: `["buildBundle", "ensureSymlink", "wireSettings"]`

- [ ] **Step 3: Commit**

```bash
git add src/install/wireHook.ts
git commit -m "feat(install): wireHook module — build + symlink + settings wireup"
```

---

## Task 8: Implement `scripts/bootstrap.ts` orchestrator

**Files:**
- Create: `scripts/bootstrap.ts`

No automated test (per spec §5.3 — clack interactions are not unit-tested). Verified by manual smoke test (Task 9).

- [ ] **Step 1: Create the orchestrator**

Create `scripts/bootstrap.ts`:

```ts
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
```

- [ ] **Step 2: Type-check the script via the bundler**

Run: `bun build scripts/bootstrap.ts --target=bun --outdir=/tmp/sl-typecheck`
Expected: build succeeds with no type errors. Delete the output: `rm -rf /tmp/sl-typecheck`.

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap.ts
git commit -m "feat(install): scripts/bootstrap.ts — clack-based installer"
```

---

## Task 9: Rewrite `bootstrap.sh` as a thin shim

**Files:**
- Modify: `bootstrap.sh`

- [ ] **Step 1: Replace bootstrap.sh entirely**

Overwrite `bootstrap.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

info() { printf '[session-logger] %s\n' "$*"; }
fail() { printf '[session-logger] %s\n' "$*" >&2; exit 1; }

# ---------- Preflight ----------

command -v git >/dev/null 2>&1 \
  || fail "git is required. Install it and re-run."
command -v bun >/dev/null 2>&1 \
  || fail "bun is required. Install: curl -fsSL https://bun.sh/install | bash"
[[ -r /dev/tty ]] \
  || fail "bootstrap.sh needs an interactive terminal. Re-run in a TTY."

# ---------- Clone or update ----------

INSTALL_DIR="${SESSION_LOGGER_DIR:-$HOME/.session-logger}"
REPO_URL="https://github.com/junepil/session-logger.git"

is_session_logger_repo() {
  local origin
  origin="$(git -C "$1" remote get-url origin 2>/dev/null)" || return 1
  case "$origin" in
    https://github.com/junepil/session-logger \
      | https://github.com/junepil/session-logger.git) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ -e "$INSTALL_DIR" ]]; then
  is_session_logger_repo "$INSTALL_DIR" \
    || fail "$INSTALL_DIR exists but is not the session-logger repo. Remove it or set SESSION_LOGGER_DIR to a different path."
  info "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only \
    || fail "Failed to fast-forward $INSTALL_DIR. Stash/commit local changes or remove the directory and re-run."
else
  info "Cloning session-logger into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ---------- Hand off to TS ----------

cd "$INSTALL_DIR"
info "Installing dependencies"
bun install
info "Running TypeScript bootstrap"
exec bun run scripts/bootstrap.ts
```

- [ ] **Step 2: Verify shellcheck passes**

Run: `shellcheck bootstrap.sh`
Expected: clean (no warnings). If `shellcheck` is not installed, run `brew install shellcheck` first, or skip and confirm via manual review that no unquoted expansions or missing checks remain.

- [ ] **Step 3: Verify the shim is still executable**

Run: `ls -l bootstrap.sh`
Expected: file mode includes `x` for owner. If not: `chmod +x bootstrap.sh`.

- [ ] **Step 4: Commit**

```bash
git add bootstrap.sh
git commit -m "refactor(bootstrap): reduce bash to thin shim, hand off to TS"
```

---

## Task 10: Delete `install.sh`

**Files:**
- Delete: `install.sh`

- [ ] **Step 1: Remove install.sh**

Run: `git rm install.sh`
Expected: file removed from working tree and staged for deletion.

- [ ] **Step 2: Verify no other file references install.sh**

Run: `grep -rn 'install.sh' . --include='*.ts' --include='*.sh' --include='*.md' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`
Expected: only references in `README.md` remain (will be updated in Task 11). No references in TS or other shell scripts.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: delete install.sh — logic moved into TS bootstrap"
```

---

## Task 11: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md content**

Overwrite `README.md` with:

```markdown
# session-logger

Claude Code SessionEnd hook that summarizes the session to an Obsidian vault journal and extracts technical concepts into vault notes.

**Supported platform:** macOS only.

## Quick install

```
bash -c "$(curl -fsSL https://raw.githubusercontent.com/junepil/session-logger/main/bootstrap.sh)"
```

Clones into `~/.session-logger` (override with `SESSION_LOGGER_DIR=...`), then hands off to an interactive TypeScript installer that:

- Verifies the Obsidian CLI is on PATH.
- Prompts for your Obsidian vault. If the vault doesn't exist yet, it creates `~/Documents/<name>` and registers it in `obsidian.json` automatically (a backup is saved).
- Pre-creates `journal/` and `concepts/` inside the resolved vault.
- Asks for `LEARNING_STACKS` and `LEARNING_DOMAINS`, writes `.env`.
- Builds the bundle, symlinks it into `~/.claude/hooks/`, and appends the SessionEnd hook to `~/.claude/settings.json` (append-only, idempotent, backup saved).

Requirements:

- `git` and [`bun`](https://bun.sh/) on PATH.
- The [official Obsidian CLI](https://obsidian.md/help/cli#Install+Obsidian+CLI) — enable it in Obsidian 1.12.7+ via Settings → General → "Command line interface". (If the third-party `Yakitrak/obsidian-cli` is already on your PATH, it satisfies the same command surface; either works.)
- Obsidian must have been installed and launched at least once so that `~/Library/Application Support/obsidian/obsidian.json` exists.

## Manual install

```
git clone https://github.com/junepil/session-logger.git ~/.session-logger
cd ~/.session-logger
bun install
bun run scripts/bootstrap.ts
```

## Configuration

`.env` keys:

- `OBSIDIAN_VAULT` — vault name to write journal and concept notes into.
- `LEARNING_STACKS` — comma-separated tech stacks you want to learn (e.g. `Spring Boot, Kotlin, AWS`). Concept extraction will focus on these. Leave empty to capture all stack concepts.
- `LEARNING_DOMAINS` — comma-separated project domains you want to learn (e.g. `Ads, Customer Data Platform`). Concept extraction will focus on these. Leave empty to capture all domain concepts.

Prompts are written in English but always produce Korean output, regardless of who runs the tool.

## Run

Hook is invoked by Claude Code via `~/.claude/settings.json`. Manual invocation:

```
# parent (reads stdin, spawns worker, exits fast)
echo '{"session_id":"<id>"}' | bun src/index.ts

# worker only (for debugging)
bun src/index.ts --worker --session-id <id>
```

## Test

```
bun test
```
```

- [ ] **Step 2: Verify no stale references**

Run: `grep -n 'install.sh\|Yakitrak' README.md`
Expected: zero matches (the Yakitrak note is intentional but should not be a recommendation — the only mention should be the "either works" parenthetical, which is acceptable).

Re-run with a stricter check:

Run: `grep -n 'install.sh' README.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README for TS bootstrap, official Obsidian CLI, macOS-only"
```

---

## Task 12: Full regression — run the entire test suite

**Files:** (none — verification only)

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: all tests pass. Specifically:

- `tests/session-logger.test.ts` — unchanged, still passes.
- `tests/wire-settings.test.ts` — unchanged, still passes.
- `tests/install/vault-layout.test.ts` — 4 tests pass.
- `tests/install/env-file.test.ts` — 5 tests pass.
- `tests/install/obsidian-vault.test.ts` — covers validate, find, resolve (existing/created/vaults-missing/target-collision/config-missing/backup/preserve).

- [ ] **Step 2: Run a clean build to confirm the bundle still produces**

Run: `rm -rf dist && bun run build && ls -la dist/`
Expected: `dist/session-logger.js` and `dist/session-logger.js.map` regenerated.

- [ ] **Step 3: Type-check the orchestrator script in isolation**

Run: `bun build scripts/bootstrap.ts --target=bun --outdir=/tmp/sl-bootstrap-check && rm -rf /tmp/sl-bootstrap-check`
Expected: bundles cleanly with no type errors.

---

## Task 13: Manual smoke test of the orchestrator

**Files:** (none — verification only)

This task validates the interactive flow end-to-end. Since clack drives stdin, it cannot be automated in `bun test`. Perform manually.

- [ ] **Step 1: Snapshot current state**

Run: `cp ~/.claude/settings.json ~/.claude/settings.json.smoke-backup`
Run: `cp -r ~/.session-logger ~/.session-logger.smoke-backup` (only if this is the actual install dir; otherwise note current dir contents).
Run: `cp "$HOME/Library/Application Support/obsidian/obsidian.json" /tmp/obsidian.json.smoke-backup`
Expected: three backup files exist.

- [ ] **Step 2: Run the orchestrator against the repo checkout**

Run from the repo root: `bun run scripts/bootstrap.ts`
Expected interactive flow:

1. Intro banner: `◆  session-logger installer`
2. Prompt: `Obsidian vault name` — type a name that already exists in `obsidian vaults` output. Submit.
3. Spinner: `Resolving Obsidian vault…` → `Using existing vault at <path>`.
4. If `journal/` or `concepts/` was missing in that vault, message: `Created journal[, concepts]/ inside vault.`
5. Prompt: `Tech stacks…` — accept default or type.
6. Prompt: `Project domains…` — accept default or type.
7. `Wrote .env`.
8. Spinner: `Building bundle…` → `Built dist/session-logger.js`.
9. `Symlinked /Users/<u>/.claude/hooks/session-logger.js`.
10. Spinner: `Wiring SessionEnd hook…` → `Wired SessionEnd hook.`
11. Outro: `Install complete.`

- [ ] **Step 3: Verify .env, symlink, and settings.json after run**

Run: `cat .env`
Expected: KEY='value' entries reflecting the answers.

Run: `ls -la ~/.claude/hooks/session-logger.js`
Expected: symlink pointing into the repo `dist/` directory.

Run: `cat ~/.claude/settings.json | python3 -m json.tool | grep -A 2 -i 'SessionEnd' | head -20`
Expected: SessionEnd hook entry present and references the symlink.

- [ ] **Step 4: Re-run to confirm update flow is idempotent**

Run: `bun run scripts/bootstrap.ts`
Expected: prompts come prefilled with the previous answers (defaults populated). After completion, `.env` content is unchanged byte-for-byte (or only differs in trailing whitespace). Symlink/settings unchanged. No backup proliferation in `obsidian.json` (vault already exists, so no new bak file).

- [ ] **Step 5: Test the vault-create path (separate, optional)**

Pick a vault name that does NOT exist in `obsidian vaults` and is NOT a directory under `~/Documents/`. Run: `bun run scripts/bootstrap.ts` and type that name.
Expected: spinner reports `Created vault at /Users/<u>/Documents/<name>`. Verify:

- Run: `ls -la ~/Documents/<name>/.obsidian` → directory exists.
- Run: `ls ~/Documents/<name>/` → contains `journal/`, `concepts/`, `.obsidian/`.
- Run: `cat "$HOME/Library/Application Support/obsidian/obsidian.json" | python3 -m json.tool | grep -B 1 '<name>'` → entry present.
- Run: `ls "$HOME/Library/Application Support/obsidian/" | grep obsidian.json.bak-` → at least one backup file.
- Open Obsidian app (restart if running). The new vault appears in the vault picker.

Clean up afterwards: remove the test vault entry from `obsidian.json` and `rm -rf ~/Documents/<name>` if desired.

- [ ] **Step 6: Restore snapshots if anything looks wrong**

If a smoke test step fails or produces unexpected state:

```bash
cp ~/.claude/settings.json.smoke-backup ~/.claude/settings.json
cp /tmp/obsidian.json.smoke-backup "$HOME/Library/Application Support/obsidian/obsidian.json"
```

Then debug the failing module and re-run only the failing tasks.

- [ ] **Step 7: Mark complete**

Once all manual checks pass, the implementation is complete. No commit (verification-only task).

---

## Done criteria

- All steps in Tasks 1–13 checked off.
- `bun test` green.
- `bun run build` succeeds.
- Manual smoke test (Task 13) shows the wizard runs cleanly for both the "vault exists" and "vault auto-created" paths.
- `install.sh` no longer in the repo.
- `bootstrap.sh` is ~30 lines and does no user prompting.
- README updated for macOS-only and official Obsidian CLI.
