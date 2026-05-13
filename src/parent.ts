import { parseHookInput } from "./parsers.ts"
import { BUN_PATH, appendErrorLog } from "./config.ts"

export async function runParent(stdin: string): Promise<void> {
  if (process.env.CLAUDE_LTM_RUNNING) return
  const parsed = parseHookInput(stdin)
  if (!parsed) return
  try {
    const child = Bun.spawn(
      [BUN_PATH, Bun.argv[1] as string, "--worker", "--session-id", parsed.sessionId],
      {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, CLAUDE_LTM_RUNNING: "1" },
      },
    )
    child.unref()
  } catch (e) {
    appendErrorLog("parent.spawn", (e as Error).message)
  }
}

export function getArg(name: string): string | null {
  const i = Bun.argv.indexOf(name)
  if (i < 0 || i + 1 >= Bun.argv.length) return null
  return Bun.argv[i + 1]
}
