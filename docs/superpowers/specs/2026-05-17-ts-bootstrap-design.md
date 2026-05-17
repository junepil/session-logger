# TS Bootstrap & Vault Provisioning — Design

Date: 2026-05-17
Status: Draft (pre-implementation)

## Context

The current installer is `bootstrap.sh` + `install.sh`. It works but the
interactive UX is plain bash `read` prompts with no validation, no
multi-select, no spinners, no progress. The user also reported missing
features:

1. When the user enters a vault name that does not exist, the installer
   fails instead of offering to create it.
2. There is no test coverage for the runtime behavior when a vault is
   missing the `journal/` or `concepts/` subdirectories that `worker.ts`
   writes into. (Verified: only parser/util tests exist.)

This spec covers a full migration of the install entry point to
TypeScript (Bun + `@clack/prompts`), the addition of an auto-vault-create
flow, install-time pre-provisioning of vault subdirectories, and the
deletion of `install.sh`.

## Goals

- Smooth, modern install UX via `@clack/prompts` (intro/outro, spinners,
  validation, prefilled defaults).
- Auto-create missing vaults at a default path under `~/Documents/`
  with no extra prompts about path.
- Pre-create `journal/` and `concepts/` inside the resolved vault at
  install time so the runtime worker never sees a missing parent.
- Drop `install.sh`. Build + symlink + `settings.json` wireup all run
  in TS.
- Migrate references to the official Obsidian CLI
  (<https://obsidian.md/help/cli>).
- macOS-only support, declared explicitly.

## Non-goals

- Linux / Windows support.
- Refactoring `scripts/wire-settings.ts` (kept as-is; called from TS
  bootstrap with the same CLI signature `install.sh` used).
- Refactoring `src/obsidian.ts` or `src/worker.ts` — the official CLI's
  surface is identical for the commands used (`vaults`, `append`,
  `create`, `delete`), so no runtime code changes.
- Rollback automation on partial install failure (current behavior:
  leave artifacts in place; re-run is idempotent).
- Bundling bootstrap as a single distributable binary.

## §1 — Architecture & Entry Point

```
curl-pipe ──▶ bootstrap.sh  (shim, ~30 lines)
              ├─ preflight: git, bun
              ├─ clone OR fast-forward pull → $SESSION_LOGGER_DIR
              ├─ cd repo && bun install
              └─ exec bun run scripts/bootstrap.ts

scripts/bootstrap.ts                       (@clack/prompts orchestrator)
  ├─ src/install/preflight.ts              obsidian CLI presence + sanity
  ├─ src/install/obsidianVault.ts          obsidian.json read/write,
  │                                        vault lookup & registration
  ├─ src/install/vaultLayout.ts            mkdir journal/, concepts/
  ├─ src/install/envFile.ts                .env round-trip read/write
  └─ src/install/wireHook.ts               build + symlink + settings.json
                                           wireup (calls existing
                                           scripts/wire-settings.ts)
```

### Removals

- `install.sh` — deleted outright. All steps move into
  `src/install/wireHook.ts`.
- Current `bootstrap.sh` body — replaced with the minimal shim.

### Bash shim responsibilities (only)

- `command -v git` / `command -v bun` checks, with install hints on
  failure.
- Resolve `$SESSION_LOGGER_DIR` (default `$HOME/.session-logger`).
- `git clone` if absent, or `git pull --ff-only` if it is already a
  `junepil/session-logger` checkout.
- `bun install` in the checkout (to fetch `@clack/prompts`).
- `exec bun run scripts/bootstrap.ts` — hand off, do not return.

The shim does **no** user prompting. All interaction happens in TS.

## §2 — Vault Verification & Creation

```
[user input: vault name]
        │
        ▼
read ~/Library/Application Support/obsidian/obsidian.json
        │
        ▼
basename(path) === input?   ── yes ──▶ use existing vault path
        │ no
        ▼
target = ~/Documents/<name>
        │
        ├─ target already exists?  ── yes ──▶ abort with
        │                                    "directory exists, pick
        │                                     a different name"
        │
        ├─ obsidian.json backup → obsidian.json.bak-<unix-ms>
        ├─ mkdir -p <target>/.obsidian
        ├─ insert new vault entry:
        │     id   = crypto.randomBytes(8).toString('hex')   (16 chars)
        │     path = absolute path to <target>
        │     ts   = Date.now()
        │     open = false
        └─ atomic write: obsidian.json.tmp → rename obsidian.json
```

### Inputs and validation

- Input is trimmed (leading/trailing whitespace).
- Reject empty string.
- Reject input containing `/` or `\` (would conflict with basename
  derivation).
- Reject input containing single quote `'` (matches current `.env`
  format constraint — the same value lands in `OBSIDIAN_VAULT`).

### obsidian.json shape

```jsonc
{
  "vaults": {
    "<16-hex-id>": {
      "path": "/Users/<u>/Documents/<name>",
      "ts": 1715000000000,
      "open": false
    }
    // ...other vaults preserved verbatim
  },
  "cli": true   // preserved as-is
}
```

### Failure modes

- `obsidian.json` missing → Obsidian not installed/run. Abort with
  "Obsidian app must be installed and run at least once before this
  installer can register a new vault."
- `obsidian.json` present but `vaults` key missing or empty object →
  treated as "no match"; proceed to create-and-register. The writer
  initializes `vaults` to `{}` before inserting the new entry.
- Orphaned entry (basename match in `obsidian.json` but the directory
  on disk is gone) → out of scope. We trust `obsidian.json`. If the
  Obsidian app errors at runtime, surface its message via the existing
  worker error log.
- Backup write fails → abort before mutating `obsidian.json`.
- Atomic rename fails → original is intact (we wrote to `.tmp`).
- Obsidian app running → no force-quit; print "Restart Obsidian to see
  the new vault." in the success message.

## §3 — Vault Layout Pre-provisioning

After §2 resolves a vault path (new or existing), the installer creates
the subdirectories `worker.ts` writes into.

```
<vault>/
  ├─ journal/      mkdir -p, idempotent
  └─ concepts/     mkdir -p, idempotent
```

### Shared constant

To prevent drift between install-time provisioning and runtime
references, both sides import a shared constant:

```ts
// src/vault-paths.ts
export const VAULT_DIRS = ["journal", "concepts"] as const
```

- `src/install/vaultLayout.ts` iterates `VAULT_DIRS` for `mkdir -p`.
- `src/worker.ts` uses the same constant for the journal/concepts paths
  it writes (currently hardcoded `journal/` and `concepts/`).

### Failure modes

- A name in `VAULT_DIRS` already exists as a **file** (not directory)
  → throw an explicit error rather than silently overwriting. The
  installer surfaces this; the user manually resolves the conflict.

## §4 — .env Handling & Install Wireup

### 4.1 .env round-trip

```
existing .env?  ── yes ──▶ loadDotEnv() → prefill defaults
                no  ──▶ blank defaults
                          │
                          ▼
clack prompts (each with defaultValue and validate):
  OBSIDIAN_VAULT     (required, value from §2)
  LEARNING_STACKS    (optional)
  LEARNING_DOMAINS   (optional)
                          │
                          ▼
write .env.tmp atomically, then rename → .env
format: KEY='value'   (empty values written as KEY=)
```

- `loadDotEnv` already strips single + double quotes (per existing
  test). Round-trip equivalence preserved.
- Validation rejects `'` in any value at the clack prompt level (same
  constraint as current bash `format_env_value`, just surfaced earlier).

### 4.2 Wireup (replaces `install.sh`)

`src/install/wireHook.ts`:

1. **Build the bundle**:
   `Bun.spawn(["bun", "run", "build"], { cwd: REPO })`.
   Abort if exit code ≠ 0. Done before any symlink work so a failure
   leaves the previous install intact.

2. **Clean up legacy symlink** (one-time migration, idempotent):
   if `~/.claude/hooks/session-logger.ts` exists and is a symlink,
   unlink it.

3. **Create / refresh symlink**:
   `mkdir -p ~/.claude/hooks`, then:
   if `~/.claude/hooks/session-logger.js` exists, unlink first.
   `fs.symlinkSync(<repo>/dist/session-logger.js, …/session-logger.js)`.

4. **Wire SessionEnd hook**:
   `Bun.spawn(["bun", "run", "scripts/wire-settings.ts",
     "--bun", BUN_PATH,
     "--script", NEW_SYMLINK,
     "--legacy-bun", BUN_PATH,
     "--legacy-script", LEGACY_SYMLINK])`.
   Same arg signature `install.sh` used today.

### 4.3 Update flow

Re-running the bootstrap = update flow:

- shim does `git pull --ff-only`, `bun install`, exec TS bootstrap.
- TS bootstrap prefills defaults from existing `.env`; user accepts or
  edits.
- If the configured vault already exists in `obsidian.json`, §2's first
  branch returns immediately without touching anything.
- §3 is idempotent.
- §4.2 is idempotent (symlink replaced, wire-settings.ts append-only).

### 4.4 Partial-failure policy (unchanged from today)

- Build fails → abort, no symlink/settings changes.
- Symlink creation fails → abort. `dist/` remains (benign).
- `settings.json` wireup fails → `wire-settings.ts` writes its own
  backup before mutating; symlink remains, idempotent on retry.
- No automated rollback. Re-running the installer is the recovery
  story.

## §5 — Testing Strategy

### 5.1 New tests

All file-system interactions go through `mkdtempSync` roots — no
contact with the real `~/Library/Application Support/obsidian/`,
`~/Documents/`, or `~/.claude/`.

**`tests/install/obsidian-vault.test.ts`** (§2)

- Input matches `basename(path)` of an existing entry → returns that
  entry's path, no mutation.
- Input matches none, target free → new entry written; id is 16 hex
  chars; `path` is absolute; `ts` is a number; existing entries
  preserved byte-for-byte.
- Input matches none, target directory already exists → throws with
  "directory exists" message; `obsidian.json` untouched.
- Names with `/`, `\`, `'`, empty, whitespace-only → all rejected by
  validator.
- `obsidian.json` missing → throws with installer-friendly message.
- Backup file `obsidian.json.bak-<digits>` written before the new
  `obsidian.json`; the backup matches the pre-mutation content
  byte-for-byte.
- Atomic write: the `.tmp` path is used; rename completes; no other
  files left behind.

**`tests/install/vault-layout.test.ts`** (§3 — direct answer to the
"are tests missing for missing dirs?" question)

- Empty vault dir → both `journal/` and `concepts/` created.
- Both already exist → idempotent, no error, no content change.
- Only `journal/` exists with pre-existing content → only `concepts/`
  created; the existing `journal/` and its files are untouched.
- `journal` exists as a file (not directory) → explicit error thrown,
  no silent overwrite.

**`tests/install/env-file.test.ts`** (§4.1)

- No `.env` → defaults object is `{ OBSIDIAN_VAULT: "", LEARNING_STACKS:
  "", LEARNING_DOMAINS: "" }`.
- Existing `.env` → `loadDotEnv` output drives prefill.
- Write produces `KEY='value'` lines with proper escaping; empty values
  produce `KEY=`.
- Value containing `'` rejected by validator.
- Round-trip: `write(values)` → `loadDotEnv(read())` returns the same
  values.

### 5.2 Existing tests (unchanged)

- `tests/session-logger.test.ts` — parsers / utils. Untouched.
- `tests/wire-settings.test.ts` — `scripts/wire-settings.ts` unchanged.

### 5.3 Out of scope

- End-to-end orchestration test of `scripts/bootstrap.ts` driving clack
  prompts. The library is trusted; per-module tests above cover the
  load-bearing logic.
- Bash shim test. `shellcheck` only.
- Runtime missing-dir handling tests in `src/obsidian.ts`. Pre-empted
  by §3 install-time provisioning.

## §6 — Official Obsidian CLI Migration

Confirmed compatible. The official CLI
(<https://obsidian.md/help/cli#Install+Obsidian+CLI>) uses the same
`parameter=value` syntax and `vault=<name>` prefix order as the
Yakitrak/obsidian-cli the project depends on today. Specifically:

| Current call shape (src/obsidian.ts)                              | Official CLI |
| ----------------------------------------------------------------- | ------------ |
| `obsidian vaults`                                                 | ✅ identical |
| `obsidian vault=<n> append path=<p> content=<c>`                  | ✅ identical |
| `obsidian vault=<n> create path=<p> content=<c>`                  | ✅ identical |
| `obsidian vault=<n> delete path=<p> permanent`                    | ✅ identical |

So `src/obsidian.ts` and `src/worker.ts` change **zero lines** under
this migration.

### What does change

- **Preflight error message** (now in TS, not bash):
  ```
  Obsidian CLI not found on PATH.

  Enable it via Obsidian 1.12.7+:
    Settings → General → "Command line interface"

  See https://obsidian.md/help/cli#Install+Obsidian+CLI
  ```
- **Preflight sanity check**: after `command -v obsidian` succeeds,
  also run `obsidian vaults` with a short timeout to confirm the
  binary is responsive. Mis-installed Yakitrak builds return errors
  that `obsidian vaults` exposes; a clean response means the CLI works
  regardless of which implementation is on PATH.
- **README**: drop the Yakitrak link from the prereqs section; replace
  with the official docs URL. Add a one-line note: "macOS only."

### PATH conflict (Yakitrak vs official)

If a user has both installed:

- Yakitrak: `/opt/homebrew/bin/obsidian`
- Official: `/usr/local/bin/obsidian` (macOS symlink target)

…`PATH` ordering picks the winner. Since both CLIs satisfy our surface,
this is benign and the installer does nothing about it. README
mentions the situation in a one-line note for users who want to switch
explicitly.

## Open questions

None at draft time. All five major decisions (vault auto-create UX,
missing-dir strategy, OS scope, TUI library, entry-point shape) and the
follow-up CLI migration choice are pinned by user selections during
brainstorming.

## Risk register

- **Obsidian schema drift**: if Obsidian changes the `obsidian.json`
  format in a future release, our writer would corrupt the file.
  Mitigation: backup-before-write is mandatory. If user reports
  corruption, the bak-file path is documented and recoverable.
- **CLI surface drift in official Obsidian CLI**: a future Obsidian
  release could change the `parameter=value` syntax. Mitigation: not
  in scope here; runtime would emit Obsidian's own error messages via
  `worker.ts`'s existing error log.
- **clack on bun**: minor compatibility risk; offset by the simple call
  surface (text + select + confirm + spinner). If clack misbehaves,
  fallback is a hand-rolled `prompts` wrapper — but that is not part
  of this spec.

## Files touched

- `bootstrap.sh` — rewritten as ~30-line shim.
- `install.sh` — deleted.
- `package.json` — add `@clack/prompts` to `dependencies`.
- `scripts/bootstrap.ts` — new.
- `src/install/preflight.ts` — new.
- `src/install/obsidianVault.ts` — new.
- `src/install/vaultLayout.ts` — new.
- `src/install/envFile.ts` — new.
- `src/install/wireHook.ts` — new.
- `src/vault-paths.ts` — new (shared `VAULT_DIRS` constant).
- `src/worker.ts` — import `VAULT_DIRS` for journal/concepts paths.
- `tests/install/obsidian-vault.test.ts` — new.
- `tests/install/vault-layout.test.ts` — new.
- `tests/install/env-file.test.ts` — new.
- `README.md` — update prereqs (official CLI, macOS-only), drop
  reference to `install.sh`.
