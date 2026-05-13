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

LEGACY_SCRIPT="$HOOKS_DIR/session-logger.ts"
NEW_SCRIPT="$HOOKS_DIR/session-logger.js"
BUNDLE="$PROJECT_DIR/dist/session-logger.js"

# Build the bundle from src/ into dist/.
# Done BEFORE the legacy symlink is removed so a build failure leaves the
# previous install intact rather than half-migrated.
( cd "$PROJECT_DIR" && "$BUN_BIN" run build )

# Remove the legacy .ts symlink left by previous installs.
if [ -L "$LEGACY_SCRIPT" ]; then
  rm "$LEGACY_SCRIPT"
fi

# Single symlink: the bundled entry script.
# Prompts and .env are NOT symlinked — the script resolves them from its real
# path via realpathSync(Bun.argv[1]).
ln -sfn "$BUNDLE" "$NEW_SCRIPT"

# Refuse to proceed if .env is missing — worker would silently no-op.
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "WARN: $PROJECT_DIR/.env not found. Copy .env.example and set OBSIDIAN_VAULT."
fi

echo "Installed symlink:"
ls -la "$NEW_SCRIPT"

"$BUN_BIN" "$PROJECT_DIR/scripts/wire-settings.ts" \
  --bun "$BUN_BIN" \
  --script "$NEW_SCRIPT" \
  --legacy-bun "$BUN_BIN" \
  --legacy-script "$LEGACY_SCRIPT"

echo "Install complete."
