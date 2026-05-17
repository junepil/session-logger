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
