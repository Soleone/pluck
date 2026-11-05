import type { AgentMessage, AgentTool } from "@/components/soleone/agent";

/** Pi's RPC records and messages, reduced to the fields pluck reads. See Pi's docs/rpc.md. */
type Part =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "thinking" | "image" };

type PiMessage =
  | { role: "user"; content: string | Part[] }
  | { role: "assistant"; content: Part[]; stopReason?: string; errorMessage?: string }
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
};

/** One session as pluck knows it: Pi's messages so far, whether it is working, and why it stopped. */
export type Transcript = { messages: PiMessage[]; busy: boolean; error?: string };

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

/** Pi's dialogs block until answered; the agents window has no UI for them yet, so they are declined. */
export function dialogReply(record: PiRecord) {
  const dialogs = ["select", "confirm", "input", "editor"];
  return record.type === "extension_ui_request" && dialogs.includes(record.method ?? "")
    ? { type: "extension_ui_response", id: record.id, cancelled: true }
    : null;
}

export function agentMessages({ messages, busy }: Transcript): AgentMessage[] {
  const results = new Map<string, Extract<PiMessage, { role: "toolResult" }>>();
  for (const message of messages)
    if (message.role === "toolResult") results.set(message.toolCallId, message);

  return messages.flatMap((message, index): AgentMessage[] => {
    const id = String(index);
    if (message.role === "user") return [{ id, role: "user", text: textOf(message.content) }];
    if (message.role !== "assistant") return [];
    const tools = message.content.flatMap((part) =>
      part.type === "toolCall" ? [toolOf(part, results.get(part.id), busy)] : [],
    );
    const failure = message.stopReason === "error" ? message.errorMessage : undefined;
    const text = [textOf(message.content), failure && `**Error:** ${failure}`]
      .filter(Boolean)
      .join("\n\n");
    return [{ id, role: "assistant", text, tools }];
  });
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

export type ModelChoice = { id: string; name: string; thinkingLevels: string[] };

/**
 * The models to offer: Pi's own scope (`enabledModels`, what Ctrl+P cycles through) when it has one,
 * else every model Pi can use. Patterns may carry a `:level` suffix and `*` wildcards.
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
    .map((model) => ({
      id: `${model.provider}/${model.id}`,
      name: model.name,
      thinkingLevels: model.reasoning
        ? thinkingLevels.filter((level) => model.thinkingLevelMap?.[level] !== null)
        : ["off"],
    }));
}
