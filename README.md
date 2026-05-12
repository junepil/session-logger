# session-logger

Claude Code SessionEnd hook that summarizes the session to an Obsidian vault journal and extracts technical concepts into vault notes.

## Quick install

```
bash -c "$(curl -fsSL https://raw.githubusercontent.com/junepil/session-logger/main/bootstrap.sh)"
```

Clones into `~/.session-logger` (override with `SESSION_LOGGER_DIR=...`), prompts for your Obsidian vault and learning focus areas, writes `.env`, runs `install.sh`. Requires `git`, `bun`, and the [obsidian CLI](https://github.com/Yakitrak/obsidian-cli) on PATH.

## Manual install

```
git clone https://github.com/junepil/session-logger.git
cd session-logger
cp .env.example .env   # then edit .env (see Configuration below)
./install.sh
```

`install.sh` creates the hook symlink at `~/.claude/hooks/session-logger.ts` and appends our SessionEnd hook to `~/.claude/settings.json` (append-only — your existing hooks are preserved, and re-running is idempotent). A backup of `settings.json` is saved before any change.

## Configuration

`.env` keys:

- `OBSIDIAN_VAULT` — vault name to write journal and concept notes into. Find it with `obsidian vaults`.
- `LEARNING_STACKS` — comma-separated tech stacks you want to learn (e.g. `Spring Boot, Kotlin, AWS`). Concept extraction will focus on these. Leave empty to capture all stack concepts.
- `LEARNING_DOMAINS` — comma-separated project domains you want to learn (e.g. `Ads, Customer Data Platform`). Concept extraction will focus on these. Leave empty to capture all domain concepts.

Prompts are written in English but always produce Korean output, regardless of who runs the tool.

## Run

Hook is invoked by Claude Code via `~/.claude/settings.json`. Manual invocation:

```
# parent (reads stdin, spawns worker, exits fast)
echo '{"session_id":"<id>"}' | bun src/session-logger.ts

# worker only (for debugging)
bun src/session-logger.ts --worker --session-id <id>
```

## Test

```
bun test
```
