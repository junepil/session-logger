import { describe, test, expect } from "bun:test"
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, existsSync, statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  validateVaultName, findVaultByName, resolveVault,
} from "../../src/install/obsidianVault.ts"

function makeHome(): { home: string; configPath: string } {
  const home = mkdtempSync(join(tmpdir(), "home-"))
  mkdirSync(join(home, "Library", "Application Support", "obsidian"), {
    recursive: true,
  })
  mkdirSync(join(home, "Documents"))
  return {
    home,
    configPath: join(home, "Library", "Application Support", "obsidian", "obsidian.json"),
  }
}

function writeConfig(path: string, body: object) {
  writeFileSync(path, JSON.stringify(body))
}

describe("validateVaultName", () => {
  test.each([[""], ["   "], ["foo/bar"], ["foo\\bar"], ["can't"]])(
    "rejects %j",
    (input) => {
      expect(validateVaultName(input)).not.toBeNull()
    },
  )
  test("accepts plain name", () => {
    expect(validateVaultName("my-vault")).toBeNull()
  })
  test("rejects leading/trailing whitespace", () => {
    expect(validateVaultName(" my")).not.toBeNull()
    expect(validateVaultName("my ")).not.toBeNull()
  })
})

describe("findVaultByName", () => {
  test("matches by basename of path", () => {
    const config = { vaults: { abc: { path: "/x/y/Notes", ts: 1 } } }
    expect(findVaultByName(config, "Notes")).toBe("/x/y/Notes")
  })
  test("returns null when no match", () => {
    expect(findVaultByName({ vaults: {} }, "x")).toBeNull()
    expect(findVaultByName({}, "x")).toBeNull()
  })
})

describe("resolveVault", () => {
  test("returns existing path when name matches", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, {
      vaults: { aaa: { path: "/some/Notes", ts: 1 } },
      cli: true,
    })
    const r = resolveVault("Notes", {
      configPath,
      homeDir: home,
      randomId: () => "0".repeat(16),
      now: () => 999,
    })
    expect(r).toEqual({ kind: "existing", path: "/some/Notes" })
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      vaults: { aaa: { path: "/some/Notes", ts: 1 } },
      cli: true,
    })
  })

  test("creates new vault under ~/Documents and updates config", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { vaults: {}, cli: true })
    const r = resolveVault("my-vault", {
      configPath,
      homeDir: home,
      randomId: () => "1234567890abcdef",
      now: () => 1700000000000,
    })
    expect(r.kind).toBe("created")
    expect(r.path).toBe(join(home, "Documents", "my-vault"))
    expect(
      statSync(join(home, "Documents", "my-vault", ".obsidian")).isDirectory(),
    ).toBe(true)
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults["1234567890abcdef"]).toEqual({
      path: join(home, "Documents", "my-vault"),
      ts: 1700000000000,
      open: false,
    })
    expect(after.cli).toBe(true)
  })

  test("initializes vaults key when missing", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { cli: true })
    const r = resolveVault("fresh", {
      configPath,
      homeDir: home,
      randomId: () => "abcdef0123456789",
      now: () => 1,
    })
    expect(r.kind).toBe("created")
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults["abcdef0123456789"].path).toBe(
      join(home, "Documents", "fresh"),
    )
  })

  test("adopts existing directory as a vault", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { vaults: {}, cli: true })
    mkdirSync(join(home, "Documents", "taken"))
    const r = resolveVault("taken", {
      configPath,
      homeDir: home,
      randomId: () => "a".repeat(16),
      now: () => 7,
    })
    expect(r.kind).toBe("adopted")
    expect(r.path).toBe(join(home, "Documents", "taken"))
    expect(
      statSync(join(home, "Documents", "taken", ".obsidian")).isDirectory(),
    ).toBe(true)
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults["a".repeat(16)]).toEqual({
      path: join(home, "Documents", "taken"),
      ts: 7,
      open: false,
    })
  })

  test("throws when target exists as a non-directory", () => {
    const { home, configPath } = makeHome()
    writeConfig(configPath, { vaults: {}, cli: true })
    writeFileSync(join(home, "Documents", "filename"), "oops")
    expect(() =>
      resolveVault("filename", {
        configPath,
        homeDir: home,
        randomId: () => "b".repeat(16),
        now: () => 0,
      }),
    ).toThrow(/not a directory/)
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      vaults: {},
      cli: true,
    })
  })

  test("throws when obsidian.json is missing", () => {
    const { home, configPath } = makeHome()
    expect(() =>
      resolveVault("any", {
        configPath,
        homeDir: home,
        randomId: () => "x".repeat(16),
        now: () => 0,
      }),
    ).toThrow(/Obsidian app must be installed/)
  })

  test("writes a backup before mutating", () => {
    const { home, configPath } = makeHome()
    const before = {
      vaults: { aaa: { path: "/x/Old", ts: 1 } },
      cli: true,
    }
    writeConfig(configPath, before)
    resolveVault("new", {
      configPath,
      homeDir: home,
      randomId: () => "y".repeat(16),
      now: () => 42,
    })
    const dir = join(home, "Library", "Application Support", "obsidian")
    const baks = readdirSync(dir).filter((f) =>
      f.startsWith("obsidian.json.bak-"),
    )
    expect(baks.length).toBe(1)
    expect(JSON.parse(readFileSync(join(dir, baks[0]), "utf8"))).toEqual(before)
  })

  test("preserves existing vault entries verbatim", () => {
    const { home, configPath } = makeHome()
    const before = {
      vaults: {
        keep1: { path: "/v/Alpha", ts: 100, open: true },
        keep2: { path: "/v/Beta", ts: 200 },
      },
      cli: true,
      extraField: "preserved",
    }
    writeConfig(configPath, before)
    resolveVault("Gamma", {
      configPath,
      homeDir: home,
      randomId: () => "z".repeat(16),
      now: () => 500,
    })
    const after = JSON.parse(readFileSync(configPath, "utf8"))
    expect(after.vaults.keep1).toEqual({
      path: "/v/Alpha",
      ts: 100,
      open: true,
    })
    expect(after.vaults.keep2).toEqual({ path: "/v/Beta", ts: 200 })
    expect(after.extraField).toBe("preserved")
  })
})
