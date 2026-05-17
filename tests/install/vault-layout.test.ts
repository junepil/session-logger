import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureVaultLayout } from "../../src/install/vaultLayout.ts"

function newVault(): string {
  return mkdtempSync(join(tmpdir(), "vault-"))
}

describe("ensureVaultLayout", () => {
  test("creates journal/ and concepts/ in an empty vault", () => {
    const vault = newVault()
    const r = ensureVaultLayout(vault)
    expect(r.created.sort()).toEqual(["concepts", "journal"])
    expect(r.existed).toEqual([])
    expect(statSync(join(vault, "journal")).isDirectory()).toBe(true)
    expect(statSync(join(vault, "concepts")).isDirectory()).toBe(true)
  })

  test("is idempotent when both dirs already exist", () => {
    const vault = newVault()
    mkdirSync(join(vault, "journal"))
    mkdirSync(join(vault, "concepts"))
    const r = ensureVaultLayout(vault)
    expect(r.created).toEqual([])
    expect(r.existed.sort()).toEqual(["concepts", "journal"])
  })

  test("creates only the missing dir, preserving existing files", () => {
    const vault = newVault()
    mkdirSync(join(vault, "journal"))
    writeFileSync(join(vault, "journal", "2026-05-17.md"), "existing")
    const r = ensureVaultLayout(vault)
    expect(r.created).toEqual(["concepts"])
    expect(r.existed).toEqual(["journal"])
    expect(existsSync(join(vault, "journal", "2026-05-17.md"))).toBe(true)
  })

  test("throws when a target name exists as a file (not directory)", () => {
    const vault = newVault()
    writeFileSync(join(vault, "journal"), "oops")
    expect(() => ensureVaultLayout(vault)).toThrow(/not a directory/)
  })
})
