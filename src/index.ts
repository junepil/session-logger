import { runParent, getArg } from "./parent.ts"
import { runWorker } from "./worker.ts"
import { appendErrorLog } from "./config.ts"

if (import.meta.main) {
  if (Bun.argv.includes("--worker")) {
    const sid = getArg("--session-id")
    if (!sid) {
      appendErrorLog("worker.entry", "missing --session-id")
      process.exit(0)
    }
    try {
      await runWorker(sid)
    } catch (e) {
      appendErrorLog("worker.uncaught", (e as Error).stack ?? String(e))
    }
    process.exit(0)
  } else {
    await runParent(await Bun.stdin.text())
    process.exit(0)
  }
}
