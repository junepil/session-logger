import { readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { VAULT, PROJECT_ROOT, PROMPTS_DIR, ENV_CONFIG, appendErrorLog } from "./config.ts"
import { extractTranscript, findJsonlPath, parseConcepts, renderPrompt } from "./parsers.ts"
import { invokeClaudePrint } from "./claude.ts"
import { obsidianAppend, obsidianCreate, isObsidianRunning } from "./obsidian.ts"

const SUMMARY_PROMPT_PATH = join(PROMPTS_DIR, "session-summary.md")
const CONCEPTS_PROMPT_PATH = join(PROMPTS_DIR, "session-concepts.md")

function loadPromptOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function formatJournalEntry(time: string, cwdName: string, body: string): string {
  return `\n## [${time} | ${cwdName}]\n\n${body}\n`
}

function todayInSeoul(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

export async function runWorker(sessionId: string): Promise<void> {
  if (!VAULT) {
    appendErrorLog("worker.config", "OBSIDIAN_VAULT not set in .env (expected at " + join(PROJECT_ROOT, ".env") + ")")
    return
  }

  await Bun.sleep(3000)

  if (!(await isObsidianRunning())) {
    console.error("Obsidian not running, skipping session log")
    return
  }

  const jsonl = findJsonlPath(sessionId)
  if (!jsonl) {
    console.error(`JSONL not found for session ${sessionId}`)
    return
  }

  const transcript = extractTranscript(jsonl)
  if (transcript.length === 0) {
    console.error(`Transcript empty for session ${sessionId}`)
    return
  }

  const { date, time } = todayInSeoul()
  const cwdName = basename(process.cwd())
  const journalPath = `journal/${date}.md`

  const summaryPrompt = loadPromptOrNull(SUMMARY_PROMPT_PATH)
  if (summaryPrompt === null) {
    await obsidianAppend(
      journalPath,
      formatJournalEntry(time, cwdName, `(prompt file missing: ${SUMMARY_PROMPT_PATH})`),
    )
    return
  }

  const summaryResult = await invokeClaudePrint(`${summaryPrompt}\n\n${transcript}`)
  const summaryBody = summaryResult.ok ? summaryResult.text : `(요약 실패 - ${summaryResult.reason})`
  await obsidianAppend(journalPath, formatJournalEntry(time, cwdName, summaryBody))

  const conceptsPrompt = loadPromptOrNull(CONCEPTS_PROMPT_PATH)
  if (conceptsPrompt === null) {
    await obsidianAppend(
      journalPath,
      formatJournalEntry(time, cwdName, `(prompt file missing: ${CONCEPTS_PROMPT_PATH})`),
    )
    return
  }

  const renderedConcepts = renderPrompt(conceptsPrompt, {
    LEARNING_STACKS: ENV_CONFIG.LEARNING_STACKS ?? "",
    LEARNING_DOMAINS: ENV_CONFIG.LEARNING_DOMAINS ?? "",
  })
  const conceptsResult = await invokeClaudePrint(`${renderedConcepts}\n\n${transcript}`)
  if (!conceptsResult.ok) {
    appendErrorLog("worker.concepts", conceptsResult.reason)
    return
  }
  const concepts = parseConcepts(conceptsResult.text)
  for (const c of concepts) {
    const tags = (c.tags ?? []).join(", ")
    const content =
      `---\ntitle: ${c.title}\ndate: ${date}\ntype: concept\ntags: [${tags}]\n---\n\n` +
      `## Summary\n${c.summary ?? ""}\n\n` +
      `## Details\n${c.details ?? ""}\n`
    const result = await obsidianCreate(`concepts/${c.filename}`, content)
    if (result === "failed") {
      appendErrorLog("worker.concept.create", `failed: ${c.filename}`)
    }
  }
}
