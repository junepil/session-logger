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
