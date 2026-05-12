#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$HOME/.claude/hooks"

mkdir -p "$HOOKS_DIR"

# Single symlink: the entry script.
# Prompts and .env are NOT symlinked — the script resolves them from its real
# path via realpathSync(Bun.argv[1]).
ln -sfn "$PROJECT_DIR/src/session-logger.ts" "$HOOKS_DIR/session-logger.ts"

# Refuse to proceed if .env is missing — worker would silently no-op.
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "WARN: $PROJECT_DIR/.env not found. Copy .env.example and set OBSIDIAN_VAULT."
fi

echo "Installed symlink:"
ls -la "$HOOKS_DIR/session-logger.ts"

echo ""
echo "Add this to ~/.claude/settings.json under SessionEnd.hooks:"
echo '{ "type": "command", "command": "/Users/junepil.lee/.bun/bin/bun /Users/junepil.lee/.claude/hooks/session-logger.ts" }'
