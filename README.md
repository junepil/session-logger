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
