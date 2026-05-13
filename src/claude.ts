import { isClaudeKnownError } from "./parsers.ts"

export type ClaudePrintResult =
  | { ok: true; text: string }
  | { ok: false; reason: string }

export async function invokeClaudePrint(prompt: string): Promise<ClaudePrintResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const proc = Bun.spawn(["claude", "--print"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    })
    proc.stdin.write(prompt)
    await proc.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      const snippet = (stdout + stderr).replace(/\s+/g, " ").slice(0, 120)
      return { ok: false, reason: `exit=${exitCode}, output=${snippet}` }
    }
    if (isClaudeKnownError(stdout)) {
      return { ok: false, reason: `exit=0, output=${stdout.slice(0, 120)}` }
    }
    return { ok: true, text: stdout.trim() }
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { ok: false, reason: "exit=124, output=(timed out after 120s)" }
    }
    return { ok: false, reason: `exit=?, output=${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}
