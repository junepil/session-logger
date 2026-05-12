#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ---------- Pretty-print helpers ----------

info() {
  printf '[session-logger] %s\n' "$*"
}

warn() {
  printf '[session-logger] %s\n' "$*" >&2
}

fail() {
  printf '[session-logger] %s\n' "$*" >&2
  exit 1
}

# ---------- Preflight ----------

if ! command -v git >/dev/null 2>&1; then
  fail "git is required. Install it and re-run."
fi

if ! command -v bun >/dev/null 2>&1; then
  fail "bun is required. Install it: curl -fsSL https://bun.sh/install | bash"
fi

if ! command -v obsidian >/dev/null 2>&1; then
  fail "obsidian CLI is required (used to write journal/concept notes). See https://github.com/Yakitrak/obsidian-cli"
fi

if [[ ! -r /dev/tty ]]; then
  fail "bootstrap.sh needs an interactive terminal. Re-run in a TTY."
fi

# ---------- Determine install dir ----------

INSTALL_DIR="${SESSION_LOGGER_DIR:-$HOME/.session-logger}"
REPO_URL="https://github.com/junepil/session-logger.git"

is_session_logger_repo() {
  local dir="$1"
  local origin
  if ! origin="$(git -C "$dir" remote get-url origin 2>/dev/null)"; then
    return 1
  fi
  case "$origin" in
    https://github.com/junepil/session-logger|https://github.com/junepil/session-logger.git)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ -e "$INSTALL_DIR" ]]; then
  if is_session_logger_repo "$INSTALL_DIR"; then
    info "Updating existing checkout at $INSTALL_DIR"
    if ! git -C "$INSTALL_DIR" pull --ff-only; then
      fail "Failed to fast-forward $INSTALL_DIR. Stash/commit local changes or remove the directory and re-run."
    fi
  else
    fail "$INSTALL_DIR exists but is not the session-logger repo. Remove it or set SESSION_LOGGER_DIR to a different path."
  fi
else
  info "Cloning session-logger into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ---------- Interactive .env ----------

# Load previous .env values as defaults, if present.
OBSIDIAN_VAULT=""
LEARNING_STACKS=""
LEARNING_DOMAINS=""

if [[ -f "$INSTALL_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set +u
  # shellcheck source=/dev/null
  source "$INSTALL_DIR/.env"
  set -u
fi

default_vault="${OBSIDIAN_VAULT:-}"
default_stacks="${LEARNING_STACKS:-}"
default_domains="${LEARNING_DOMAINS:-}"

# --- OBSIDIAN_VAULT ---

vaults_out=""
if out="$(obsidian vaults 2>/dev/null)"; then
  vaults_out="$out"
fi

# Count non-empty lines.
vault_count=0
if [[ -n "$vaults_out" ]]; then
  # POSIX-ish line count of non-empty lines.
  vault_count="$(printf '%s\n' "$vaults_out" | awk 'NF{c++} END{print c+0}')"
fi

if [[ "$vault_count" -eq 1 ]]; then
  single_vault="$(printf '%s\n' "$vaults_out" | awk 'NF{print; exit}')"
  if [[ -z "$default_vault" ]]; then
    default_vault="$single_vault"
  fi
elif [[ "$vault_count" -ge 2 ]]; then
  info "Available vaults:"
  printf '%s\n' "$vaults_out" | awk 'NF{print "  - " $0}'
fi

vault_input=""
while :; do
  if [[ -n "$default_vault" ]]; then
    printf 'Obsidian vault name [%s]: ' "$default_vault" > /dev/tty
  else
    printf 'Obsidian vault name: ' > /dev/tty
  fi
  read -r vault_input < /dev/tty || vault_input=""
  # Trim leading/trailing whitespace.
  vault_input="${vault_input#"${vault_input%%[![:space:]]*}"}"
  vault_input="${vault_input%"${vault_input##*[![:space:]]}"}"
  if [[ -z "$vault_input" && -n "$default_vault" ]]; then
    vault_input="$default_vault"
  fi
  if [[ -n "$vault_input" ]]; then
    break
  fi
  warn "Obsidian vault is required."
done
OBSIDIAN_VAULT="$vault_input"

# --- LEARNING_STACKS (optional) ---

stacks_input=""
if [[ -n "$default_stacks" ]]; then
  printf 'Tech stacks to focus on, comma-separated [%s]: ' "$default_stacks" > /dev/tty
else
  printf 'Tech stacks to focus on, comma-separated: ' > /dev/tty
fi
read -r stacks_input < /dev/tty || stacks_input=""
if [[ -z "$stacks_input" ]]; then
  LEARNING_STACKS="$default_stacks"
else
  LEARNING_STACKS="$stacks_input"
fi

# --- LEARNING_DOMAINS (optional) ---

domains_input=""
if [[ -n "$default_domains" ]]; then
  printf 'Project domains to focus on, comma-separated [%s]: ' "$default_domains" > /dev/tty
else
  printf 'Project domains to focus on, comma-separated: ' > /dev/tty
fi
read -r domains_input < /dev/tty || domains_input=""
if [[ -z "$domains_input" ]]; then
  LEARNING_DOMAINS="$default_domains"
else
  LEARNING_DOMAINS="$domains_input"
fi

# ---------- Write .env atomically ----------

format_env_value() {
  local val="$1"
  if [[ -z "$val" ]]; then
    return 0
  fi
  case "$val" in
    *"'"*) fail "Value cannot contain a literal single quote: $val" ;;
  esac
  printf "'%s'" "$val"
}

env_tmp="$INSTALL_DIR/.env.tmp"
env_final="$INSTALL_DIR/.env"

{
  printf '# Obsidian vault to write journal and concept notes into.\n'
  printf '# Find your vault names with: `obsidian vaults`\n'
  printf 'OBSIDIAN_VAULT=%s\n' "$(format_env_value "$OBSIDIAN_VAULT")"
  printf '\n'
  printf '# Comma-separated tech stacks you want to learn (e.g. "Spring Boot, Kotlin, AWS").\n'
  printf '# Concept extraction will focus on these stacks. Leave empty to capture all.\n'
  printf 'LEARNING_STACKS=%s\n' "$(format_env_value "$LEARNING_STACKS")"
  printf '\n'
  printf '# Comma-separated project domains you want to learn (e.g. "Ads, Customer Data Platform").\n'
  printf '# Concept extraction will focus on these domains. Leave empty to capture all.\n'
  printf 'LEARNING_DOMAINS=%s\n' "$(format_env_value "$LEARNING_DOMAINS")"
} > "$env_tmp"

mv "$env_tmp" "$env_final"
info "Wrote $env_final"

# ---------- Run install.sh ----------

info "Running install.sh"
cd "$INSTALL_DIR"
./install.sh

# ---------- Final message ----------

info "Install complete."
info "Installed at: $INSTALL_DIR"
