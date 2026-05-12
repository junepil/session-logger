import { describe, test, expect } from "bun:test"
import { mergeHook, type HookEntry } from "../scripts/wire-settings.ts"

const entry: HookEntry = { type: "command", command: "/bun /hook.ts" }
const existing: HookEntry = { type: "command", command: "/bun /other.ts" }
const other: HookEntry = { type: "command", command: "/bun /pre.ts" }

describe("mergeHook", () => {
  test("creates full skeleton when current is null", () => {
    const out = mergeHook(null, entry)
    expect(out.status).toBe("created")
    expect((out.result as any).hooks.SessionEnd[0].hooks).toEqual([entry])
  })

  test("undefined input is treated like null (created)", () => {
    const out = mergeHook(undefined, entry)
    expect(out.status).toBe("created")
    expect((out.result as any).hooks.SessionEnd[0].hooks).toEqual([entry])
  })

  test("creates skeleton on empty object, no other keys", () => {
    const out = mergeHook({}, entry)
    expect(out.status).toBe("created")
    expect(out.result).toEqual({ hooks: { SessionEnd: [{ hooks: [entry] }] } })
  })

  test("preserves unrelated top-level keys", () => {
    const out = mergeHook({ otherKey: "x" }, entry)
    expect(out.status).toBe("created")
    expect((out.result as any).otherKey).toBe("x")
    expect((out.result as any).hooks.SessionEnd[0].hooks).toEqual([entry])
  })

  test("creates SessionEnd when hooks is empty object", () => {
    const out = mergeHook({ hooks: {} }, entry)
    expect(out.status).toBe("created")
    expect((out.result as any).hooks.SessionEnd[0].hooks).toEqual([entry])
  })

  test("pushes new group when SessionEnd is empty array", () => {
    const out = mergeHook({ hooks: { SessionEnd: [] } }, entry)
    expect(out.status).toBe("pushed-group")
    const se = (out.result as any).hooks.SessionEnd
    expect(se.length).toBe(1)
    expect(se[0].hooks).toEqual([entry])
    expect(se[0].matcher).toBeUndefined()
  })

  test("appends to first no-matcher group", () => {
    const input = { hooks: { SessionEnd: [{ hooks: [existing] }] } }
    const out = mergeHook(input, entry)
    expect(out.status).toBe("appended")
    const se = (out.result as any).hooks.SessionEnd
    expect(se.length).toBe(1)
    expect(se[0].hooks).toEqual([existing, entry])
  })

  test("pushes new group at end when only matcher groups exist", () => {
    const matcherGroup = { matcher: "PreTool", hooks: [other] }
    const input = { hooks: { SessionEnd: [matcherGroup] } }
    const out = mergeHook(input, entry)
    expect(out.status).toBe("pushed-group")
    const se = (out.result as any).hooks.SessionEnd
    expect(se.length).toBe(2)
    expect(se[0]).toEqual(matcherGroup)
    expect(se[1]).toEqual({ hooks: [entry] })
    expect(se[1].matcher).toBeUndefined()
  })

  test("appends to no-matcher group even when matcher group precedes it", () => {
    const matcherGroup = { matcher: "PreTool", hooks: [other] }
    const input = {
      hooks: {
        SessionEnd: [
          matcherGroup,
          { hooks: [existing] },
        ],
      },
    }
    const out = mergeHook(input, entry)
    expect(out.status).toBe("appended")
    expect((out.result as any).hooks.SessionEnd[0]).toEqual(matcherGroup)
    expect((out.result as any).hooks.SessionEnd[1].hooks).toEqual([existing, entry])
  })

  test("idempotent: returns already-wired when entry already present in no-matcher group", () => {
    const input = { hooks: { SessionEnd: [{ hooks: [entry] }] } }
    const out = mergeHook(input, entry)
    expect(out.status).toBe("already-wired")
    expect(out.result).toEqual(input)
  })

  test("idempotent across matcher-scoped groups", () => {
    const input = { hooks: { SessionEnd: [{ matcher: "PreTool", hooks: [entry] }] } }
    const out = mergeHook(input, entry)
    expect(out.status).toBe("already-wired")
    expect(out.result).toEqual(input)
  })

  test("throws when current is not an object", () => {
    expect(() => mergeHook("x", entry)).toThrow("must be a JSON object")
  })

  test("throws when current.hooks is not an object", () => {
    expect(() => mergeHook({ hooks: "x" }, entry)).toThrow("settings.hooks")
  })

  test("throws when SessionEnd is not an array", () => {
    expect(() => mergeHook({ hooks: { SessionEnd: "x" } }, entry)).toThrow("SessionEnd")
  })

  test("throws when no-matcher group has non-array hooks", () => {
    expect(() => mergeHook({ hooks: { SessionEnd: [{ hooks: "nope" }] } }, entry))
      .toThrow(/SessionEnd\[\]\.hooks must be an array/)
  })

  test("purity: mutating the result does not affect the input", () => {
    const input = { hooks: { SessionEnd: [{ hooks: [existing] }] } }
    const out = mergeHook(input, entry)
    // Mutate the returned result aggressively
    const se = (out.result as any).hooks.SessionEnd
    se.push({ hooks: [{ type: "command", command: "x" }] })
    se[0].hooks.push({ type: "command", command: "y" })
    // The original input should be unchanged
    expect(input).toEqual({ hooks: { SessionEnd: [{ hooks: [existing] }] } })
  })
})
