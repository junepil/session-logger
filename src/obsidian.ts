import { VAULT } from "./config.ts"
import { detectDuplicateCreate } from "./parsers.ts"

export async function obsidianRun(args: string[]): Promise<string> {
  const proc = Bun.spawn(["obsidian", `vault=${VAULT}`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return (stdout + stderr).trim()
}

export async function obsidianAppend(path: string, content: string): Promise<boolean> {
  let out = await obsidianRun(["append", `path=${path}`, `content=${content}`])
  if (out.includes("not found")) {
    const date = path.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? ""
    const header =
      `---\ntitle: Journal ${date}\ndate: ${date}\ntype: journal\ntags: [journal, ltm]\n---\n`
    const createOut = await obsidianRun([
      "create", `path=${path}`, `content=${header}`,
    ])
    const dup = detectDuplicateCreate(createOut)
    if (dup) {
      await obsidianRun(["delete", `path=${dup}`, "permanent"])
    }
    out = await obsidianRun(["append", `path=${path}`, `content=${content}`])
  }
  return out.startsWith("Appended")
}

export async function obsidianCreate(path: string, content: string): Promise<"created" | "exists" | "failed"> {
  const out = await obsidianRun(["create", `path=${path}`, `content=${content}`])
  const dup = detectDuplicateCreate(out)
  if (dup) {
    await obsidianRun(["delete", `path=${dup}`, "permanent"])
    return "exists"
  }
  if (out.startsWith("Created:")) return "created"
  return "failed"
}

export async function isObsidianRunning(): Promise<boolean> {
  const proc = Bun.spawn(["pgrep", "-x", "Obsidian"], { stdout: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}
