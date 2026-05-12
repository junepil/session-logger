#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$HOME/.claude/hooks"

BUN_BIN="$(command -v bun)"
if [[ -z "$BUN_BIN" ]]; then
  echo "bun is required but not found on PATH." >&2
  exit 1
fi

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

HOOK_SCRIPT="$HOOKS_DIR/session-logger.ts"
"$BUN_BIN" "$PROJECT_DIR/scripts/wire-settings.ts" --bun "$BUN_BIN" --script "$HOOK_SCRIPT"

echo "Install complete."
