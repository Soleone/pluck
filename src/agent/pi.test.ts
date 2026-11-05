import { expect, test } from "vite-plus/test";
import {
  agentMessages,
  applyRecord,
  dialogOf,
  emptyTranscript,
  modelChoices,
  type PiModel,
  type PiRecord,
} from "./pi";

const text = (value: string) => [{ type: "text" as const, text: value }];
const call = { type: "toolCall" as const, id: "t1", name: "bash", arguments: { command: "ls" } };

const replay = (records: PiRecord[]) => records.reduce(applyRecord, emptyTranscript);

test("agent.stream: text streams in and a tool call runs, then completes", () => {
  const started = replay([
    { type: "agent_start" },
    { type: "message_start", message: { role: "user", content: text("hi") } },
    { type: "message_end", message: { role: "user", content: text("hi") } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_end", message: { role: "assistant", content: [call] } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
    },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo" },
    },
  ]);
  expect(started.busy).toBe(true);
  const [user, step, reply] = agentMessages(started);
  expect(user).toMatchObject({ role: "user", text: "hi" });
  expect(step?.tools).toMatchObject([{ label: "Running ls", status: "running" }]);
  expect(reply).toMatchObject({ role: "assistant", text: "Hello" });

  const done = (
    [
      {
        type: "message_start",
        message: { role: "toolResult", toolCallId: "t1", content: text("a"), isError: false },
      },
      { type: "agent_settled" },
    ] satisfies PiRecord[]
  ).reduce(applyRecord, started);
  expect(done.busy).toBe(false);
  expect(agentMessages(done)[1]?.tools).toMatchObject([
    { label: "Ran ls", status: "complete", output: "a" },
  ]);
});

test("agent.stream: a tool call without a result after the run is shown as failed", () => {
  const transcript = replay([
    { type: "message_start", message: { role: "assistant", content: [call] } },
    { type: "agent_settled" },
  ]);
  expect(agentMessages(transcript)[0]?.tools).toMatchObject([
    { status: "error", label: "Failed to run ls" },
  ]);
});

test("agent.stream: a provider error shows in the reply", () => {
  const transcript = replay([
    {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "Rate limited",
      },
    },
  ]);
  expect(agentMessages(transcript)[0]?.text).toBe("**Error:** Rate limited");
});

test("agent.reopen: get_messages replaces the history and hides system messages", () => {
  const transcript = replay([
    {
      type: "response",
      command: "get_messages",
      success: true,
      data: {
        messages: [
          { role: "system" },
          { role: "user", content: "old question" },
          { role: "assistant", content: text("old answer") },
        ],
      },
    },
  ]);
  expect(agentMessages(transcript).map((message) => message.text)).toEqual([
    "old question",
    "old answer",
  ]);
});

test("agent.dialogs: dialogs are shown, notifications are not", () => {
  const confirm = { type: "extension_ui_request", id: "d", method: "confirm", title: "Allow?" };
  expect(dialogOf(confirm)).toMatchObject({ id: "d", method: "confirm", title: "Allow?" });
  expect(dialogOf({ type: "extension_ui_request", id: "n", method: "notify" })).toBeNull();
});

const models: PiModel[] = [
  {
    id: "sonnet",
    name: "Sonnet",
    provider: "anthropic",
    reasoning: true,
    thinkingLevelMap: { off: null },
  },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", reasoning: false },
  { id: "gpt-5", name: "GPT-5", provider: "openai", reasoning: true },
];

test("settings.agent-models: Pi's scope picks the models, with wildcards and level suffixes", () => {
  const scoped = modelChoices(models, {
    enabledModels: ["anthropic/sonnet:high", "openai/gpt-5*"],
  });
  expect(scoped.map((choice) => choice.id)).toEqual(["anthropic/sonnet", "openai/gpt-5"]);
  expect(modelChoices(models, null)).toHaveLength(3);
});

test("settings.agent-thinking: levels are the ones the model supports", () => {
  const [sonnet, gpt4o] = modelChoices(models, null);
  expect(sonnet?.thinkingLevels).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  expect(gpt4o?.thinkingLevels).toEqual(["off"]);
});

test("settings.agent-thinking: each model shows the level Pi starts it with", () => {
  const settings = { defaultThinkingLevel: "high", modelThinkingLevels: { "openai/gpt-5": "max" } };
  const [sonnet, gpt4o, gpt5] = modelChoices(models, settings);
  expect([sonnet?.thinking, gpt4o?.thinking, gpt5?.thinking]).toEqual(["high", "off", "max"]);
  expect(modelChoices(models, null)[0]?.thinking).toBe("medium");
});
