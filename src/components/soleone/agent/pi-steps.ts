import type { AgentSource, AgentTool } from "./agent-panel"

type Status = AgentTool["status"]
type Args = Record<string, unknown>

/** How a step reads: "Searching for “x”" while it runs, "Searched for “x”" when done, "Failed to search for “x”". */
export type PiStep = {
  verbs: Record<Status, string>
  subject: (args: Args) => string | undefined
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

const firstLine = (value: unknown) => (typeof value === "string" ? value.split("\n")[0] : undefined)
const more = (count: number) => (count > 1 ? ` and ${count - 1} more` : "")
const pagesOf = ({ url, urls }: Args) =>
  [url, urls].flat().filter((page): page is string => typeof page === "string" && URL.canParse(page))
const run = { running: "Running", complete: "Ran", error: "Failed to run" }

/** Pi's built-in tools and pi-web-access's web tools. Hosts spread this into a table with their own tools. */
export const piSteps: Record<string, PiStep> = {
  bash: { verbs: run, subject: ({ command }) => firstLine(command) },
  read: { verbs: { running: "Reading", complete: "Read", error: "Failed to read" }, subject: ({ path }) => firstLine(path) },
  edit: { verbs: { running: "Editing", complete: "Edited", error: "Failed to edit" }, subject: ({ path }) => firstLine(path) },
  write: { verbs: { running: "Writing", complete: "Wrote", error: "Failed to write" }, subject: ({ path }) => firstLine(path) },
  grep: { verbs: { running: "Searching for", complete: "Searched for", error: "Failed to search for" }, subject: ({ pattern }) => firstLine(pattern) },
  find: { verbs: { running: "Finding", complete: "Found", error: "Failed to find" }, subject: ({ pattern }) => firstLine(pattern) },
  ls: { verbs: { running: "Listing", complete: "Listed", error: "Failed to list" }, subject: ({ path }) => firstLine(path) },
  web_search: {
    verbs: { running: "Searching", complete: "Searched", error: "Failed to search" },
    subject: ({ query, queries }) => {
      const all = Array.isArray(queries) ? queries : [query]
      return typeof all[0] === "string" ? `for “${all[0]}”${more(all.length)}` : "the web"
    },
    // Results arrive as text with their links.
    sources: (_args, output) => (output ? sourcesIn(output) : undefined),
  },
  fetch_content: {
    verbs: { running: "Reading", complete: "Read", error: "Failed to read" },
    subject: (args) => {
      const pages = pagesOf(args)
      return pages.length ? `${new URL(pages[0]).hostname}${more(pages.length)}` : "a page"
    },
    // Known from the call, so the sites show while the pages load.
    sources: (args) => pagesOf(args).map((url) => ({ url })),
  },
}

/** The title and sources of one tool call; tools missing from `steps` read "Running <name>". */
export function piStep(
  call: { name: string; arguments: Args },
  status: Status,
  output?: string,
  steps: Record<string, PiStep> = piSteps,
): Pick<AgentTool, "label" | "sources"> {
  const step = steps[call.name]
  if (!step) return { label: `${run[status]} ${call.name}` }
  return {
    label: `${step.verbs[status]} ${step.subject(call.arguments) ?? ""}`.trim(),
    sources: step.sources?.(call.arguments, output),
  }
}
