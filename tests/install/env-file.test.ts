import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readEnvDefaults, validateEnvValue, writeEnv } from "../../src/install/envFile.ts"
import { loadDotEnv } from "../../src/parsers.ts"

function newRepo(): string {
  return mkdtempSync(join(tmpdir(), "repo-"))
}

describe("readEnvDefaults", () => {
  test("returns blank defaults when .env missing", () => {
    const repo = newRepo()
    expect(readEnvDefaults(repo)).toEqual({
      OBSIDIAN_VAULT: "",
      LEARNING_STACKS: "",
      LEARNING_DOMAINS: "",
    })
  })

  test("prefills from existing .env", () => {
    const repo = newRepo()
    writeFileSync(
      join(repo, ".env"),
      "OBSIDIAN_VAULT='my'\nLEARNING_STACKS='a, b'\nLEARNING_DOMAINS=\n",
    )
    expect(readEnvDefaults(repo)).toEqual({
      OBSIDIAN_VAULT: "my",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "",
    })
  })
})

describe("validateEnvValue", () => {
  test("returns null for safe values", () => {
    expect(validateEnvValue("hello world")).toBeNull()
    expect(validateEnvValue("")).toBeNull()
  })
  test("rejects values containing a single quote", () => {
    expect(validateEnvValue("can't")).toMatch(/single quote/)
  })
})

describe("writeEnv", () => {
  test("writes KEY='value' format with atomic rename", () => {
    const repo = newRepo()
    writeEnv(repo, {
      OBSIDIAN_VAULT: "v",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "",
    })
    const content = readFileSync(join(repo, ".env"), "utf8")
    expect(content).toContain("OBSIDIAN_VAULT='v'")
    expect(content).toContain("LEARNING_STACKS='a, b'")
    expect(content).toContain("LEARNING_DOMAINS=")
    expect(existsSync(join(repo, ".env.tmp"))).toBe(false)
  })

  test("throws when a value contains a single quote", () => {
    const repo = newRepo()
    expect(() =>
      writeEnv(repo, {
        OBSIDIAN_VAULT: "can't",
        LEARNING_STACKS: "",
        LEARNING_DOMAINS: "",
      }),
    ).toThrow(/single quote/)
  })

  test("round-trips with loadDotEnv", () => {
    const repo = newRepo()
    const values = {
      OBSIDIAN_VAULT: "vault name",
      LEARNING_STACKS: "a, b",
      LEARNING_DOMAINS: "X, Y",
    }
    writeEnv(repo, values)
    const parsed = loadDotEnv(readFileSync(join(repo, ".env"), "utf8"))
    expect(parsed.OBSIDIAN_VAULT).toBe(values.OBSIDIAN_VAULT)
    expect(parsed.LEARNING_STACKS).toBe(values.LEARNING_STACKS)
    expect(parsed.LEARNING_DOMAINS).toBe(values.LEARNING_DOMAINS)
  })
})
