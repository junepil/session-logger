export type PreflightResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

const OBSIDIAN_CLI_MISSING_MESSAGE =
  "Obsidian CLI not found on PATH.\n\n" +
  "Enable it via Obsidian 1.12.7+:\n" +
  "  Settings → General → \"Command line interface\"\n\n" +
  "See https://obsidian.md/help/cli#Install+Obsidian+CLI"

export function checkObsidianCli(): PreflightResult {
  const bin = Bun.which("obsidian")
  if (!bin) {
    return { ok: false, message: OBSIDIAN_CLI_MISSING_MESSAGE }
  }
  return { ok: true, path: bin }
}
