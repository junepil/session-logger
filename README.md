# session-logger

Claude Code SessionEnd hook that summarizes the session to an Obsidian vault journal and extracts technical concepts into vault notes.

## Install

```
cp .env.example .env   # then edit .env (see Configuration below)
./install.sh
```

The installer creates one symlink (`~/.claude/hooks/session-logger.ts`) and prints the settings.json command to wire in. Prompts live in `prompts/` and are loaded by the script from its real path (no second symlink needed).

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
