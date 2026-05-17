// Subdirectories that worker.ts writes into and that the installer
// pre-creates. Single source of truth shared between install-time
// provisioning (src/install/vaultLayout.ts) and runtime (src/worker.ts).
export const VAULT_DIRS = ["journal", "concepts"] as const

export const JOURNAL_DIR = "journal"
export const CONCEPTS_DIR = "concepts"
