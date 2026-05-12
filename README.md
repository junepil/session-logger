# session-logger

Claude Code SessionEnd hook that summarizes the session to an Obsidian vault journal and extracts technical concepts into vault notes.

## Install

```
cp .env.example .env   # then edit .env to set OBSIDIAN_VAULT
./install.sh
```

The installer creates one symlink (`~/.claude/hooks/session-logger.ts`) and prints the settings.json command to wire in. Prompts live in `prompts/` and are loaded by the script from its real path (no second symlink needed).

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
