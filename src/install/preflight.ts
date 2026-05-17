export type PreflightResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

const OBSIDIAN_CLI_MISSING_MESSAGE =
  "Obsidian CLI not found on PATH.\n\n" +
  "Enable it via Obsidian 1.12.7+:\n" +
  "  Settings → General → \"Command line interface\"\n\n" +
  "See https://obsidian.md/help/cli#Install+Obsidian+CLI"

const OBSIDIAN_CLI_BROKEN_MESSAGE =
  "Obsidian CLI is on PATH but does not respond to `obsidian vaults`.\n\n" +
  "The binary may be mis-installed. Re-enable it via:\n" +
  "  Obsidian 1.12.7+ → Settings → General → \"Command line interface\"\n\n" +
  "See https://obsidian.md/help/cli#Install+Obsidian+CLI"

export async function checkObsidianCli(): Promise<PreflightResult> {
  const bin = Bun.which("obsidian")
  if (!bin) {
    return { ok: false, message: OBSIDIAN_CLI_MISSING_MESSAGE }
  }

  const proc = Bun.spawn([bin, "vaults"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => proc.kill(), 3000)
  try {
    await proc.exited
  } finally {
    clearTimeout(timeout)
  }
  if (proc.exitCode !== 0) {
    return { ok: false, message: OBSIDIAN_CLI_BROKEN_MESSAGE }
  }
  return { ok: true, path: bin }
}
