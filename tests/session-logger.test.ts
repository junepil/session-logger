import { describe, test, expect } from "bun:test"
import { parseHookInput } from "../src/session-logger.ts"

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
