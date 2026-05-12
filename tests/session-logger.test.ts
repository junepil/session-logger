import { describe, test, expect } from "bun:test"
import { parseHookInput, extractTranscript } from "../src/session-logger.ts"
import { join } from "node:path"

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
