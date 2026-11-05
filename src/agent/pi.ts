import type { AgentMessage, AgentTool } from "@/components/soleone/agent";

/** Pi's RPC records and messages, reduced to the fields pluck reads. See Pi's docs/rpc.md. */
type Part =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "thinking" | "image" };

type PiMessage =
  | { role: "user"; content: string | Part[] }
  | {
      role: "assistant";
      content: Part[];
      stopReason?: string;
      errorMessage?: string;
      provider?: string;
      model?: string;
    }
  | { role: "toolResult"; toolCallId: string; content: Part[]; isError: boolean }
  // System prompts, bash runs and extension entries aren't shown.
  | { role: "system" | "bashExecution" | "custom" };

type StreamEvent =
  | { type: "text_start" | "thinking_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: Part }
  | { type: string };

/** Which fields are set depends on `type`. */
export type PiRecord = {
  type: string;
  message?: PiMessage;
  assistantMessageEvent?: StreamEvent;
  command?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
  id?: string;
  method?: string;
};

export type PiModel = {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null> | null;
};

export type PiSettings = {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  /** The thinking level Pi last used with each model, by `provider/id`. */
  modelThinkingLevels?: Record<string, string>;
};

/** One session as pluck knows it: Pi's messages so far, whether it is working, why it stopped,
 * and the model and thinking level it runs with. */
export type Transcript = {
  messages: PiMessage[];
  busy: boolean;
  error?: string;
  model?: { name: string; thinking: string };
};

export const emptyTranscript: Transcript = { messages: [], busy: false };

export function applyRecord(transcript: Transcript, record: PiRecord): Transcript {
  const { messages } = transcript;
  switch (record.type) {
    case "agent_start":
      return { ...transcript, busy: true, error: undefined };
    case "agent_settled":
      return { ...transcript, busy: false };
    case "message_start":
      return { ...transcript, messages: [...messages, record.message!] };
    case "message_end":
      return { ...transcript, messages: [...messages.slice(0, -1), record.message!] };
    case "message_update": {
      const last = messages.at(-1);
      if (last?.role !== "assistant") return transcript;
      const content = stream(last.content, record.assistantMessageEvent!);
      return { ...transcript, messages: [...messages.slice(0, -1), { ...last, content }] };
    }
    case "response":
      if (!record.success) return { ...transcript, error: record.error };
      if (record.command === "get_messages")
        return { ...transcript, messages: (record.data as { messages: PiMessage[] }).messages };
      if (record.command === "get_state") {
        const state = record.data as { model?: { name: string }; thinkingLevel: string };
        return state.model
          ? { ...transcript, model: { name: state.model.name, thinking: state.thinkingLevel } }
          : transcript;
      }
      return transcript;
    default:
      return transcript;
  }
}

/** Builds the streaming reply from Pi's deltas; `message_end` then replaces it with the final one. */
function stream(content: Part[], event: StreamEvent): Part[] {
  if (!("contentIndex" in event)) return content;
  const next = [...content];
  const index = event.contentIndex;
  if (event.type === "text_start") next[index] = { type: "text", text: "" };
  else if (event.type === "thinking_start") next[index] = { type: "thinking" };
  else if (event.type === "text_delta" && "delta" in event) {
    const part = next[index];
    next[index] = { type: "text", text: (part?.type === "text" ? part.text : "") + event.delta };
  } else if (event.type === "toolcall_start" && "toolName" in event)
    next[index] = { type: "toolCall", id: event.id, name: event.toolName, arguments: {} };
  else if (event.type === "toolcall_end" && "toolCall" in event) next[index] = event.toolCall;
  return next;
}

/** A question from one of Pi's extensions; Pi waits for the answer, or its timeout. */
export type PiDialog =
  | { id: string; method: "select"; title: string; options: string[] }
  | { id: string; method: "confirm"; title: string; message?: string }
  | { id: string; method: "input"; title: string; placeholder?: string }
  | { id: string; method: "editor"; title: string; prefill?: string };

/** The dialog a record asks for. Other UI requests, like notifications, need no answer. */
export function dialogOf(record: PiRecord): PiDialog | null {
  const dialogs = ["select", "confirm", "input", "editor"];
  return record.type === "extension_ui_request" && dialogs.includes(record.method ?? "")
    ? (record as unknown as PiDialog)
    : null;
}

export function agentMessages({ messages, busy }: Transcript): AgentMessage[] {
  const results = new Map<string, Extract<PiMessage, { role: "toolResult" }>>();
  for (const message of messages)
    if (message.role === "toolResult") results.set(message.toolCallId, message);

  return messages.flatMap((message, index): AgentMessage[] => {
    const id = String(index);
    if (message.role === "user") return [{ id, role: "user", ...quoteOf(textOf(message.content)) }];
    if (message.role !== "assistant") return [];
    const tools = message.content.flatMap((part) =>
      part.type === "toolCall" ? [toolOf(part, results.get(part.id), busy)] : [],
    );
    // Pi's errors, like "Connection error.", don't say which model failed.
    const failure =
      message.stopReason === "error"
        ? [message.errorMessage, message.model && `(${message.provider}/${message.model})`]
            .filter(Boolean)
            .join(" ")
        : undefined;
    const text = [textOf(message.content), failure && `**Error:** ${failure}`]
      .filter(Boolean)
      .join("\n\n");
    return [{ id, role: "assistant", text, tools }];
  });
}

/** What pluck's agent actions send (see `agent_prompt` in lib.rs). */
const pluckPrompt = /^([\s\S]*?)\n\nText from (.+?)(?: at (\S+))?:\n\n<text>\n([\s\S]*)\n<\/text>$/;

/** Splits a prompt pluck built into the request and the text it is about. */
export function quoteOf(prompt: string): Pick<AgentMessage, "text" | "quote"> {
  const match = pluckPrompt.exec(prompt);
  if (!match) return { text: prompt };
  const [, request = "", from = "", href, text = ""] = match;
  // "app (window title)"; the title usually names the app too.
  const source =
    from === "the clipboard" ? "Clipboard" : (/^\S+ \((.*)\)$/.exec(from)?.[1] ?? from);
  return { text: request, quote: { text, source, href } };
}

function textOf(content: string | Part[]) {
  if (typeof content === "string") return content;
  return content.flatMap((part) => (part?.type === "text" ? [part.text] : [])).join("\n\n");
}

const verbs: Record<string, Record<AgentTool["status"], string>> = {
  bash: { running: "Running", complete: "Ran", error: "Failed to run" },
  read: { running: "Reading", complete: "Read", error: "Failed to read" },
  edit: { running: "Editing", complete: "Edited", error: "Failed to edit" },
  write: { running: "Writing", complete: "Wrote", error: "Failed to write" },
  grep: { running: "Searching for", complete: "Searched for", error: "Failed to search for" },
  find: { running: "Finding", complete: "Found", error: "Failed to find" },
  ls: { running: "Listing", complete: "Listed", error: "Failed to list" },
};

function toolOf(
  call: Extract<Part, { type: "toolCall" }>,
  result: Extract<PiMessage, { role: "toolResult" }> | undefined,
  busy: boolean,
): AgentTool {
  // A call without a result after the run ended was cut off.
  const status = result ? (result.isError ? "error" : "complete") : busy ? "running" : "error";
  const { command, path, pattern } = call.arguments;
  const subject = [command, path, pattern]
    .find((value) => typeof value === "string")
    ?.split("\n")[0];
  const known = verbs[call.name];
  const label = known
    ? `${known[status]} ${subject ?? ""}`.trim()
    : `${verbs.bash![status]} ${call.name}`;
  return { id: call.id, name: call.name, label, status, output: result && textOf(result.content) };
}

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** `thinking` is the level Pi starts the model with when pluck names no level. */
export type ModelChoice = { id: string; name: string; thinkingLevels: string[]; thinking: string };

/**
 * The models to offer: Pi's own scope (`enabledModels`, what Ctrl+P cycles through) when it has one,
 * else every model Pi can use. Patterns may carry a `:level` suffix and `*` wildcards.
 * Like Pi, a model's thinking is its last used level, else Pi's default, else medium, and never
 * more than the model supports.
 */
export function modelChoices(models: PiModel[], settings: PiSettings | null): ModelChoice[] {
  const patterns = (settings?.enabledModels ?? []).map((pattern) => {
    const glob = pattern.replace(/:[a-z]+$/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${glob.replaceAll("*", ".*")}$`, "i");
  });
  return models
    .filter(
      (model) =>
        !patterns.length ||
        patterns.some(
          (pattern) => pattern.test(`${model.provider}/${model.id}`) || pattern.test(model.id),
        ),
    )
    .map((model) => {
      const id = `${model.provider}/${model.id}`;
      const supported = model.reasoning
        ? thinkingLevels.filter((level) => model.thinkingLevelMap?.[level] !== null)
        : ["off"];
      const wanted =
        settings?.modelThinkingLevels?.[id] ?? settings?.defaultThinkingLevel ?? "medium";
      const below = supported.filter(
        (level) => thinkingLevels.indexOf(level) <= thinkingLevels.indexOf(wanted),
      );
      return { id, name: model.name, thinkingLevels: supported, thinking: below.at(-1) ?? "off" };
    });
}
