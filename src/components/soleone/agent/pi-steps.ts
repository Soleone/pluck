import type { AgentSource, AgentTool } from "./agent-panel"

type Status = AgentTool["status"]
type Args = Record<string, unknown>

/** How a step reads: "Searching for “x”" while it runs, "Searched for “x”" when done, "Failed to search for “x”". */
export type PiStep = {
  verbs: Record<Status, string>
  /** The full call, shown when the step opens since the title may cut it short. */
  input?: (args: Args) => string | undefined
  /** The title's end; the first line of `input` when left out. */
  subject?: (args: Args) => string | undefined
  /** Web pages the step searched or read, from its arguments or its output. */
  sources?: (args: Args, output?: string) => AgentSource[] | undefined
}

/** The http(s) links in a tool's output, once each. */
function sourcesIn(text: string): AgentSource[] {
  const urls = text.match(/https?:\/\/[^\s"'<>()[\]]+/g) ?? []
  return [...new Set(urls.map((url) => url.replace(/[.,;:!?]+$/, "")))]
    .filter((url) => URL.canParse(url))
    .map((url) => ({ url }))
}

const firstLine = (value: string | undefined) => value?.split("\n")[0]
const more = (count: number) => (count > 1 ? ` and ${count - 1} more` : "")
const text = (key: string) => (args: Args) => (typeof args[key] === "string" ? args[key] : undefined)
const queriesOf = ({ query, queries }: Args) =>
  [queries ?? query].flat().filter((value): value is string => typeof value === "string")
const pagesOf = ({ url, urls }: Args) =>
  [url, urls].flat().filter((page): page is string => typeof page === "string" && URL.canParse(page))
const lines = (values: string[]) => (values.length ? values.join("\n") : undefined)
const run = { running: "Running", complete: "Ran", error: "Failed to run" }

/** Pi's built-in tools and pi-web-access's web tools. Hosts spread this into a table with their own tools. */
export const piSteps: Record<string, PiStep> = {
  bash: { verbs: run, input: text("command") },
  read: { verbs: { running: "Reading", complete: "Read", error: "Failed to read" }, input: text("path") },
  edit: { verbs: { running: "Editing", complete: "Edited", error: "Failed to edit" }, input: text("path") },
  write: { verbs: { running: "Writing", complete: "Wrote", error: "Failed to write" }, input: text("path") },
  grep: { verbs: { running: "Searching for", complete: "Searched for", error: "Failed to search for" }, input: text("pattern") },
  find: { verbs: { running: "Finding", complete: "Found", error: "Failed to find" }, input: text("pattern") },
  ls: { verbs: { running: "Listing", complete: "Listed", error: "Failed to list" }, input: text("path") },
  web_search: {
    verbs: { running: "Searching", complete: "Searched", error: "Failed to search" },
    input: (args) => lines(queriesOf(args)),
    subject: (args) => {
      const all = queriesOf(args)
      return all.length ? `for “${all[0]}”${more(all.length)}` : "the web"
    },
    // Results arrive as text with their links.
    sources: (_args, output) => (output ? sourcesIn(output) : undefined),
  },
  fetch_content: {
    verbs: { running: "Reading", complete: "Read", error: "Failed to read" },
    input: (args) => lines(pagesOf(args)),
    subject: (args) => {
      const pages = pagesOf(args)
      return pages.length ? `${new URL(pages[0]).hostname}${more(pages.length)}` : "a page"
    },
    // Known from the call, so the sites show while the pages load.
    sources: (args) => pagesOf(args).map((url) => ({ url })),
  },
}

/** The title, input and sources of one tool call; tools missing from `steps` read "Running <name>" and show their arguments. */
export function piStep(
  call: { name: string; arguments: Args },
  status: Status,
  output?: string,
  steps: Record<string, PiStep> = piSteps,
): Pick<AgentTool, "label" | "input" | "sources"> {
  const step = steps[call.name]
  if (!step) return { label: `${run[status]} ${call.name}`, input: JSON.stringify(call.arguments, null, 2) }
  const input = step.input?.(call.arguments)
  const subject = step.subject ? step.subject(call.arguments) : firstLine(input)
  return {
    label: `${step.verbs[status]} ${subject ?? ""}`.trim(),
    input,
    sources: step.sources?.(call.arguments, output),
  }
}
