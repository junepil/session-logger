import { readFileSync, existsSync } from "node:fs"

export function parseHookInput(json: string): { sessionId: string } | null {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed?.session_id === "string" && parsed.session_id.length > 0) {
      return { sessionId: parsed.session_id }
    }
    return null
  } catch {
    return null
  }
}

export function extractTranscript(jsonlPath: string): string {
  if (!existsSync(jsonlPath)) return ""
  const raw = readFileSync(jsonlPath, "utf8")
  const lines = raw.split("\n").filter(l => l.trim().length > 0)
  const items: { ts: string; role: string; text: string }[] = []
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (o.type !== "user" && o.type !== "assistant") continue
      const c = o.message?.content
      let text = ""
      if (typeof c === "string") {
        text = c
      } else if (Array.isArray(c)) {
        text = c
          .filter((x: any) => x?.type === "text" && typeof x.text === "string")
          .map((x: any) => x.text)
          .join(" ")
      }
      if (text.trim().length === 0) continue
      items.push({ ts: o.timestamp ?? "", role: o.type, text })
    } catch {
      continue
    }
  }
  items.sort((a, b) => a.ts.localeCompare(b.ts))
  return items.map(i => `[${i.role}] ${i.text}`).join("\n")
}
