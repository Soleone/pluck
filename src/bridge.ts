import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { PiModel, PiRecord, PiSettings } from "@/agent/pi";

export type Action = {
  id: string;
  name: string;
  key: string | null;
  run: string;
  /** Set on actions that start an agent session on this prompt instead of running a script. */
  agent: string | null;
  output: "show" | "copy" | "notify";
};

/** Unset model and thinking use the harness's own defaults. */
export type AgentSettings = {
  harness: "pi";
  model: string | null;
  thinking: string | null;
  /** Where new sessions run, inside WSL when `wsl` is set. */
  folder: string;
  /** Windows only: run the harness installed in WSL. */
  wsl: boolean;
};

export type AgentSession = { id: string; title: string; folder: string; wsl: boolean };

/** A record from a session's harness, or its exit with the reason. */
type AgentEvent = { id: string; record: PiRecord | null; exited: string | null };

/** A menu action asking the agents window to start a session. */
type AgentRequest = { title: string; prompt: string };

export type AgentCatalog = { models: PiModel[]; settings: PiSettings | null };

/** What the menu shows for one trigger. */
export type Opened = {
  text: string;
  /** Nothing was selected, so `text` is what the clipboard held. */
  clipboard: boolean;
  app: string;
  title: string;
  actions: Action[];
  problems: string[];
};

/** Progress of a `show` action; `run` is the number the menu passed to `run()`. */
type RunEvent = { run: number; line: string | null; done: boolean; error: string | null };

/** What the home screen shows. */
export type HomeState = {
  version: string;
  hotkey: string;
  configDir: string;
  actions: Action[];
  problems: string[];
  agent: AgentSettings;
  /** Only Windows has the WSL choice. */
  windows: boolean;
};

export type Update = { version: string; install(): Promise<void> };

type Bridge = {
  /** Calls the listener each time the menu opens. Returns a function that stops listening. */
  onOpen(listener: (opened: Opened) => void): () => void;
  onRun(listener: (event: RunEvent) => void): () => void;
  run(actionId: string, run: number): Promise<void>;
  dismiss(): Promise<void>;
  homeState(): Promise<HomeState>;
  /** Rejects with the reason when the hotkey can't be used; the previous one stays. */
  setHotkey(hotkey: string): Promise<void>;
  pauseHotkey(): Promise<void>;
  openConfigFolder(): Promise<void>;
  editConfig(): Promise<void>;
  /** A newer release, or null when current, offline or a development build. */
  availableUpdate(): Promise<Update | null>;
  setAgentSettings(agent: AgentSettings): Promise<void>;
  /** Takes a few seconds: it starts the harness to ask. */
  agentCatalog(): Promise<AgentCatalog>;
  agentSessions(): Promise<AgentSession[]>;
  /** Runs session `id`, adding it to the list when it is new. `title` is only used then. */
  agentStart(id: string, title: string): Promise<void>;
  agentSend(id: string, record: object): Promise<void>;
  onAgent(listener: (event: AgentEvent) => void): () => void;
  onAgentRequest(listener: (request: AgentRequest) => void): () => void;
  showAgents(): Promise<void>;
};

function subscribe<T>(event: string, listener: (payload: T) => void) {
  const stop = listen<T>(event, ({ payload }) => listener(payload));
  return () => void stop.then((unlisten) => unlisten());
}

const native: Bridge = {
  onOpen: (listener) => subscribe("pluck://open", listener),
  onRun: (listener) => subscribe("pluck://run", listener),
  run: (actionId, run) => invoke("run_action", { id: actionId, run }),
  dismiss: () => invoke("dismiss"),
  homeState: () => invoke("home_state"),
  setHotkey: (hotkey) => invoke("set_hotkey", { hotkey }),
  pauseHotkey: () => invoke("pause_hotkey"),
  openConfigFolder: () => invoke("open_config_folder"),
  editConfig: () => invoke("edit_config"),
  async availableUpdate() {
    if (import.meta.env.DEV) return null;
    const update = await check().catch(() => null);
    if (!update) return null;
    return {
      version: update.version,
      async install() {
        await update.downloadAndInstall();
        // Windows never gets here: its installer quits pluck and starts it again.
        await relaunch();
      },
    };
  },
  setAgentSettings: (agent) => invoke("set_agent_settings", { agent }),
  agentCatalog: () => invoke("agent_models"),
  agentSessions: () => invoke("agent_sessions"),
  agentStart: (id, title) => invoke("agent_start", { id, title }),
  agentSend: (id, record) => invoke("agent_send", { id, record: JSON.stringify(record) }),
  onAgent: (listener) => subscribe("pluck://agent", listener),
  onAgentRequest: (listener) => subscribe("pluck://agent-request", listener),
  showAgents: () => invoke("show_agents"),
};

const ps = (script: string) =>
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\${script}.ps1`;

const sample: Opened = {
  text: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
  clipboard: false,
  app: "chrome",
  title: "Ludwig Wittgenstein - Wikipedia",
  actions: [
    {
      id: "explain",
      name: "Explain",
      key: "e",
      run: "",
      agent: "Explain this briefly.",
      output: "notify",
    },
    {
      id: "translate",
      name: "Translate to English",
      key: "t",
      run: ps("translate"),
      agent: null,
      output: "notify",
    },
    {
      id: "search",
      name: "Search the web",
      key: "s",
      run: ps("search"),
      agent: null,
      output: "notify",
    },
    {
      id: "bookmark",
      name: "Save as bookmark",
      key: "b",
      run: ps("bookmark"),
      agent: null,
      output: "notify",
    },
    { id: "count", name: "Count words", key: "w", run: ps("count"), agent: null, output: "show" },
    { id: "upper", name: "Uppercase", key: "u", run: ps("upper"), agent: null, output: "copy" },
  ],
  problems: [],
};

const cannedLines = [
  "Wittgenstein's line from the Tractatus: ",
  "the limits of my language mean the limits of my world.\n",
  "\nWhat we can't put into words, we can't really think about either.\n",
];

const text = (value: string) => [{ type: "text" as const, text: value }];

/** What Pi sends for one prompt: a bash step, then a streamed answer. */
function cannedRun(prompt: string): PiRecord[] {
  const user = { role: "user" as const, content: text(prompt) };
  const call = {
    type: "toolCall" as const,
    id: "count",
    name: "bash",
    arguments: { command: "wc -w" },
  };
  const result = {
    role: "toolResult" as const,
    toolCallId: "count",
    content: text("9"),
    isError: false,
  };
  return [
    { type: "agent_start" },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_end", message: { role: "assistant", content: [call] } },
    { type: "message_start", message: result },
    { type: "message_end", message: result },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
    ...cannedLines.map((delta) => ({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
    })),
    { type: "message_end", message: { role: "assistant", content: text(cannedLines.join("")) } },
    { type: "agent_settled" },
  ];
}

const catalog: AgentCatalog = {
  models: [
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic", reasoning: true },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic", reasoning: true },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", reasoning: false },
  ],
  settings: {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-5-5",
    defaultThinkingLevel: "medium",
    enabledModels: ["anthropic/*"],
  },
};

/** `pnpm dev:web`: sample text and actions, canned output, and the menu reopens after closing. */
function prototype(): Bridge {
  let hotkey = "Ctrl+Alt+Space";
  let agent: AgentSettings = {
    harness: "pi",
    model: null,
    thinking: null,
    folder: "~",
    wsl: false,
  };
  const sessions: AgentSession[] = [
    {
      id: "sample",
      title: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
      folder: "~",
      wsl: false,
    },
  ];
  let openListener: ((opened: Opened) => void) | undefined;
  let runListener: ((event: RunEvent) => void) | undefined;
  let agentListener: ((event: AgentEvent) => void) | undefined;
  const dismiss = async () => void setTimeout(() => openListener?.(sample), 500);
  const reply = (id: string, records: PiRecord[]) =>
    records.forEach((record, index) =>
      setTimeout(() => agentListener?.({ id, record, exited: null }), 250 * (index + 1)),
    );

  return {
    onOpen(listener) {
      openListener = listener;
      listener(sample);
      return () => (openListener = undefined);
    },
    onRun(listener) {
      runListener = listener;
      return () => (runListener = undefined);
    },
    async run(actionId, run) {
      if (sample.actions.find((action) => action.id === actionId)?.output !== "show")
        return dismiss();
      const events = [
        ...cannedLines.map((line) => ({ line, done: false })),
        { line: null, done: true },
      ];
      events.forEach((event, index) =>
        setTimeout(() => runListener?.({ run, error: null, ...event }), 300 * (index + 1)),
      );
    },
    dismiss,
    homeState: async () => ({
      version: "0.1.0",
      hotkey,
      configDir: "C:\\Users\\you\\AppData\\Roaming\\pluck",
      actions: sample.actions,
      problems: [],
      agent,
      windows: true,
    }),
    async setHotkey(next) {
      if (next === "Super+Space")
        throw new Error("That hotkey is taken by the system or another app.");
      hotkey = next;
    },
    pauseHotkey: async () => {},
    openConfigFolder: async () => {},
    editConfig: async () => {},
    availableUpdate: async () => ({
      version: "0.2.0",
      install: () => new Promise((resolve) => setTimeout(resolve, 1500)),
    }),
    async setAgentSettings(next) {
      agent = next;
    },
    agentCatalog: () => new Promise((resolve) => setTimeout(() => resolve(catalog), 800)),
    agentSessions: async () => [...sessions],
    async agentStart(id, title) {
      if (!sessions.some((session) => session.id === id))
        sessions.unshift({ id, title, folder: agent.folder, wsl: agent.wsl });
    },
    async agentSend(id, record) {
      const command = record as { type: string; message?: string };
      if (command.type === "prompt") reply(id, cannedRun(command.message ?? ""));
      if (command.type === "abort") reply(id, [{ type: "agent_settled" }]);
      if (command.type === "get_messages") {
        const messages =
          id === "sample"
            ? cannedRun(sample.text).flatMap((record) =>
                record.type === "message_end" ? [record.message] : [],
              )
            : [];
        reply(id, [
          { type: "response", command: "get_messages", success: true, data: { messages } },
        ]);
      }
    },
    onAgent(listener) {
      agentListener = listener;
      return () => (agentListener = undefined);
    },
    onAgentRequest: () => () => {},
    showAgents: async () => {},
  };
}

export const bridge = isTauri() ? native : prototype();
