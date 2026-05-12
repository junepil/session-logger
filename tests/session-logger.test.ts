import { describe, test, expect } from "bun:test"
import { parseHookInput, extractTranscript, findJsonlPath } from "../src/session-logger.ts"
import { join } from "node:path"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"

describe("parseHookInput", () => {
  test("returns sessionId from valid JSON", () => {
    const out = parseHookInput('{"session_id":"abc-123"}')
    expect(out).toEqual({ sessionId: "abc-123" })
  })
  test("returns null for invalid JSON", () => {
    expect(parseHookInput("not json")).toBeNull()
  })
  test("returns null when session_id missing", () => {
    expect(parseHookInput('{"other":"x"}')).toBeNull()
  })
  test("returns null when session_id not a string", () => {
    expect(parseHookInput('{"session_id":42}')).toBeNull()
  })
})

describe("extractTranscript", () => {
  const fixture = join(import.meta.dir, "fixtures/sample-session.jsonl")
  test("extracts user+assistant text in order, skips tool I/O", () => {
    const t = extractTranscript(fixture)
    expect(t).toBe(
      "[user] What's the weather like?\n" +
      "[assistant] Let me check.\n" +
      "[assistant] It's sunny outside.\n" +
      "[user] Thanks!"
    )
  })
  test("returns empty string when file missing", () => {
    expect(extractTranscript("/nonexistent/path.jsonl")).toBe("")
  })
})

describe("findJsonlPath", () => {
  test("finds JSONL by session id under nested project dir", () => {
    const root = mkdtempSync(join(tmpdir(), "sl-"))
    const projectDir = join(root, "some-project")
    mkdirSync(projectDir, { recursive: true })
    const file = join(projectDir, "session-abc.jsonl")
    writeFileSync(file, "")
    expect(findJsonlPath("session-abc", root)).toBe(file)
  })
  test("returns null when not found", () => {
    const root = mkdtempSync(join(tmpdir(), "sl-"))
    expect(findJsonlPath("missing", root)).toBeNull()
  })
})

import {
  parseConcepts,
  detectDuplicateCreate,
  isClaudeKnownError,
  loadDotEnv,
} from "../src/session-logger.ts"

describe("parseConcepts", () => {
  test("extracts JSON array embedded in text", () => {
    const raw = 'Here is the result:\n[{"filename":"x.md","title":"X","tags":["a"],"summary":"s","details":"d"}]\nextra'
    expect(parseConcepts(raw)).toEqual([
      { filename: "x.md", title: "X", tags: ["a"], summary: "s", details: "d" },
    ])
  })
  test("returns [] when no JSON array present", () => {
    expect(parseConcepts("nothing here")).toEqual([])
  })
  test("returns [] when JSON is malformed", () => {
    expect(parseConcepts("[broken")).toEqual([])
  })
  test("skips entries missing filename or title", () => {
    const raw = '[{"filename":"a.md"},{"filename":"b.md","title":"B"}]'
    expect(parseConcepts(raw)).toEqual([{ filename: "b.md", title: "B" }])
  })
})

describe("detectDuplicateCreate", () => {
  test("detects ' 1.md' suffix in Created: line", () => {
    expect(detectDuplicateCreate("Created: concepts/foo 1.md"))
      .toBe("concepts/foo 1.md")
  })
  test("returns null for normal create output", () => {
    expect(detectDuplicateCreate("Created: concepts/foo.md")).toBeNull()
  })
})

describe("isClaudeKnownError", () => {
  test.each([
    ["Not logged in"],
    ["Error: something"],
    ["Invalid API key"],
    ["Please run /login"],
  ])("detects '%s' prefix", (msg) => {
    expect(isClaudeKnownError(msg)).toBe(true)
  })
  test("false for normal output", () => {
    expect(isClaudeKnownError("Today we discussed ...")).toBe(false)
  })
})

describe("loadDotEnv", () => {
  test("parses KEY=VALUE pairs", () => {
    expect(loadDotEnv("FOO=bar\nBAZ=qux"))
      .toEqual({ FOO: "bar", BAZ: "qux" })
  })
  test("strips surrounding quotes", () => {
    expect(loadDotEnv('A="hello world"\nB=\'x\''))
      .toEqual({ A: "hello world", B: "x" })
  })
  test("ignores comments and blank lines", () => {
    expect(loadDotEnv("# a comment\n\nKEY=value\n"))
      .toEqual({ KEY: "value" })
  })
  test("returns empty object for empty input", () => {
    expect(loadDotEnv("")).toEqual({})
  })
})
