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
  /** Set on actions that send this prompt to the agent instead of running a script. */
  agent: string | null;
  output: "show" | "copy" | "notify" | "replace";
  /** Agent actions only: false shows the agent's reply in the menu instead of opening a session. */
  interactive: boolean;
} & SessionModel;

/** For a new session; unset ones fall back to the agent settings. */
export type SessionModel = { model: string | null; thinking: string | null };

/** Unset model and thinking use the harness's own defaults. */
export type AgentSettings = {
  harness: "pi";
  /** Where new sessions run, inside WSL when the settings say so. */
  folder: string;
} & SessionModel;

export type AgentSession = {
  id: string;
  title: string;
  folder: string;
  wsl: boolean;
  /** When it last finished a run, in ms since 1970; 0 when unknown. */
  lastActive: number;
};

/** A record from a session's harness, or its exit with the reason. */
type AgentEvent = { id: string; record: PiRecord | null; exited: string | null };

/** The menu asking the agents window to send a prompt, to `session` or else a new session. */
type AgentRequest = { title: string; prompt: string; session: string | null } & SessionModel;

/** `start` is the model, as `provider/id`, and thinking level Pi starts a new session with. */
export type AgentCatalog = {
  models: PiModel[];
  settings: PiSettings | null;
  start: { model: string; thinking: string } | null;
};

/** What the menu shows for one trigger. */
export type Opened = {
  text: string;
  /** Nothing was selected, so `text` is what the clipboard held. */
  clipboard: boolean;
  app: string;
  title: string;
  /** The page the text was copied from, when the browser says so; else empty. */
  url: string;
  actions: Action[];
  problems: string[];
  /** The most recently active agent session, which agent actions can continue. */
  lastSession: AgentSession | null;
};

/** Progress of a `show` or `replace` action; `run` is the number the menu passed to `run()`. */
type RunEvent = { run: number; line: string | null; done: boolean; error: string | null };

/** What the home screen shows. */
export type HomeState = {
  version: string;
  hotkey: string;
  configDir: string;
  actions: Action[];
  problems: string[];
  agent: AgentSettings;
  platform: "windows" | "macos" | "linux";
  /** Windows only: scripts and agents run inside WSL. */
  wsl: boolean;
  autostart: boolean;
};

export type Update = { version: string; install(): Promise<void> };

type Bridge = {
  /** Calls the listener each time the menu opens. Returns a function that stops listening. */
  onOpen(listener: (opened: Opened) => void): () => void;
  onRun(listener: (event: RunEvent) => void): () => void;
  /** Agent actions go to the menu's last session when `continueSession` is set. */
  run(actionId: string, run: number, continueSession: boolean): Promise<void>;
  /** Asks the agent `question` about the menu's text. */
  ask(question: string, continueSession: boolean): Promise<void>;
  /** Puts `text` in place of the selection, or on the clipboard when the text came from there. */
  replace(text: string): Promise<void>;
  dismiss(): Promise<void>;
  homeState(): Promise<HomeState>;
  /** Rejects with the reason when the hotkey can't be used; the previous one stays. */
  setHotkey(hotkey: string): Promise<void>;
  pauseHotkey(): Promise<void>;
  setWsl(wsl: boolean): Promise<void>;
  setAutostart(enabled: boolean): Promise<void>;
  /** A folder for agent sessions, named as WSL names it when they run there; null when cancelled. */
  pickFolder(): Promise<string | null>;
  openConfigFolder(): Promise<void>;
  /** Opens a web link in the default browser. */
  openUrl(url: string): Promise<void>;
  editConfig(): Promise<void>;
  /** Writes the menu's actions, in order, to pluck.toml. Rejects while an entry there is invalid. */
  saveActions(actions: Action[]): Promise<void>;
  /** A newer release, or null when current, offline or a development build. */
  availableUpdate(): Promise<Update | null>;
  setAgentSettings(agent: AgentSettings): Promise<void>;
  /** Takes a few seconds: it starts the harness to ask. */
  agentCatalog(): Promise<AgentCatalog>;
  agentSessions(): Promise<AgentSession[]>;
  /** Runs session `id`, adding it to the list when it is new. `title` and `model` are only used then. */
  agentStart(id: string, title: string, model?: SessionModel): Promise<void>;
  agentSend(id: string, record: object): Promise<void>;
  /** Stops the session and takes it off the list; the harness keeps its own copy. */
  agentRemove(id: string): Promise<void>;
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
  run: (actionId, run, continueSession) =>
    invoke("run_action", { id: actionId, run, continueSession }),
  ask: (question, continueSession) => invoke("ask", { question, continueSession }),
  replace: (text) => invoke("replace", { text }),
  dismiss: () => invoke("dismiss"),
  homeState: () => invoke("home_state"),
  setHotkey: (hotkey) => invoke("set_hotkey", { hotkey }),
  pauseHotkey: () => invoke("pause_hotkey"),
  setWsl: (wsl) => invoke("set_wsl", { wsl }),
  setAutostart: (enabled) => invoke("set_autostart", { enabled }),
  pickFolder: () => invoke("pick_folder"),
  openConfigFolder: () => invoke("open_config_folder"),
  openUrl: (url) => invoke("open_url", { url }),
  editConfig: () => invoke("edit_config"),
  saveActions: (actions) => invoke("save_actions", { actions }),
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
  agentStart: (id, title, model) => invoke("agent_start", { id, title, ...model }),
  agentSend: (id, record) => invoke("agent_send", { id, record: JSON.stringify(record) }),
  agentRemove: (id) => invoke("agent_remove", { id }),
  onAgent: (listener) => subscribe("pluck://agent", listener),
  onAgentRequest: (listener) => subscribe("pluck://agent-request", listener),
  showAgents: () => invoke("show_agents"),
};

const sessionDefaults = { interactive: true, model: null, thinking: null };

const scriptAction = (
  id: string,
  name: string,
  key: string,
  output: Action["output"] = "notify",
) => ({
  id,
  name,
  key,
  run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/${id}.ps1`,
  agent: null,
  output,
  ...sessionDefaults,
});

const promptAction = (id: string, name: string, key: string, agent: string): Action => ({
  id,
  name,
  key,
  run: "",
  agent,
  output: "notify",
  ...sessionDefaults,
});

const sample: Opened = {
  text: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
  clipboard: false,
  app: "chrome",
  title: "Ludwig Wittgenstein - Wikipedia",
  url: "https://en.wikipedia.org/wiki/Ludwig_Wittgenstein",
  actions: [
    promptAction("explain", "Explain", "e", "Explain this briefly."),
    {
      ...promptAction("define", "Define", "d", "Define this in one sentence."),
      interactive: false,
      thinking: "off",
    },
    scriptAction("translate", "Translate to English", "t"),
    scriptAction("search", "Search the web", "s"),
    scriptAction("bookmark", "Save as bookmark", "b"),
    scriptAction("count", "Count words", "w", "show"),
    scriptAction("upper", "Uppercase", "u", "replace"),
  ],
  problems: [],
  lastSession: null,
};

const cannedLines = [
  "Wittgenstein's line from the Tractatus: ",
  "the limits of my language mean the limits of my world.\n",
  "\nWhat we can't put into words, we can't really think about either.\n",
];

const text = (value: string) => [{ type: "text" as const, text: value }];

/** What Pi sends for one prompt: a web search, then a streamed answer. */
function cannedRun(prompt: string): PiRecord[] {
  const user = { role: "user" as const, content: text(prompt) };
  const call = {
    type: "toolCall" as const,
    id: "search",
    name: "web_search",
    arguments: { queries: ["Tractatus limits of my language", "Wittgenstein language and world"] },
  };
  const result = {
    role: "toolResult" as const,
    toolCallId: "search",
    content: text(
      [
        "Sources",
        "- https://en.wikipedia.org/wiki/Tractatus_Logico-Philosophicus",
        "- https://plato.stanford.edu/entries/wittgenstein/",
        "- https://www.gutenberg.org/ebooks/5740",
        "- https://www.britannica.com/biography/Ludwig-Wittgenstein",
      ].join("\n"),
    ),
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
    modelThinkingLevels: { "anthropic/claude-opus-5-5": "high" },
  },
  start: { model: "anthropic/claude-sonnet-5-5", thinking: "medium" },
};

/** `pnpm dev:web`: sample text and actions, canned output, and the menu reopens after closing. */
function prototype(): Bridge {
  let hotkey = "Ctrl+Alt+Space";
  let agent: AgentSettings = { harness: "pi", model: null, thinking: null, folder: "~" };
  let wsl = false;
  let autostart = true;
  let sessions: AgentSession[] = [
    {
      id: "sample",
      title: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
      folder: "~",
      wsl: false,
      lastActive: Date.now() - 3 * 60_000,
    },
  ];
  let openListener: ((opened: Opened) => void) | undefined;
  let runListener: ((event: RunEvent) => void) | undefined;
  let agentListener: ((event: AgentEvent) => void) | undefined;
  const dismiss = async () =>
    void setTimeout(() => openListener?.({ ...sample, lastSession: sessions[0] ?? null }), 500);
  const reply = (id: string, records: PiRecord[]) =>
    records.forEach((record, index) =>
      setTimeout(() => agentListener?.({ id, record, exited: null }), 250 * (index + 1)),
    );

  return {
    onOpen(listener) {
      openListener = listener;
      listener({ ...sample, lastSession: sessions[0] ?? null });
      return () => (openListener = undefined);
    },
    onRun(listener) {
      runListener = listener;
      return () => (runListener = undefined);
    },
    async run(actionId, run) {
      const action = sample.actions.find((candidate) => candidate.id === actionId);
      const output = action?.agent && !action.interactive ? "show" : action?.output;
      if (output === "replace")
        return void setTimeout(
          () => runListener?.({ run, line: sample.text.toUpperCase(), done: true, error: null }),
          300,
        );
      if (output !== "show") return dismiss();
      const events = [
        ...cannedLines.map((line) => ({ line, done: false })),
        { line: null, done: true },
      ];
      events.forEach((event, index) =>
        setTimeout(() => runListener?.({ run, error: null, ...event }), 300 * (index + 1)),
      );
    },
    ask: dismiss,
    replace: dismiss,
    dismiss,
    homeState: async () => ({
      version: "0.1.0",
      hotkey,
      configDir: "C:\\Users\\you\\AppData\\Roaming\\pluck",
      actions: sample.actions,
      problems: [],
      agent,
      platform: "windows",
      wsl,
      autostart,
    }),
    async setHotkey(next) {
      if (next === "Super+Space")
        throw new Error("That hotkey is taken by the system or another app.");
      hotkey = next;
    },
    pauseHotkey: async () => {},
    async setWsl(next) {
      wsl = next;
    },
    async setAutostart(next) {
      autostart = next;
    },
    pickFolder: async () => "/home/you/src",
    openConfigFolder: async () => {},
    openUrl: async (url) => void window.open(url, "_blank", "noopener"),
    editConfig: async () => {},
    async saveActions(actions) {
      sample.actions = actions;
    },
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
        sessions.unshift({ id, title, folder: agent.folder, wsl, lastActive: Date.now() });
    },
    async agentRemove(id) {
      sessions = sessions.filter((session) => session.id !== id);
    },
    async agentSend(id, record) {
      const command = record as { type: string; message?: string };
      if (command.type === "prompt") {
        // A prompt mentioning a dialog shows how an extension's question looks.
        const dialog = {
          type: "extension_ui_request",
          id: "sample-dialog",
          method: "confirm",
          title: "Allow this command?",
          message: "rm -rf build",
        } as unknown as PiRecord; // Its `message` is text, not a chat message.
        const run = cannedRun(command.message ?? "");
        reply(id, command.message?.includes("dialog") ? [dialog, ...run] : run);
        sessions = sessions.map((session) =>
          session.id === id ? { ...session, lastActive: Date.now() } : session,
        );
      }
      if (command.type === "abort") reply(id, [{ type: "agent_settled" }]);
      if (command.type === "get_state") {
        const data = { model: { name: "GPT-6.1 Sol" }, thinkingLevel: "high" };
        reply(id, [{ type: "response", command: "get_state", success: true, data }]);
      }
      if (command.type === "get_messages") {
        const messages =
          id === "sample"
            ? cannedRun(
                `Explain this briefly.\n\nText from ${sample.app} (${sample.title}) at ${sample.url}:\n\n<text>\n${sample.text}\n</text>`,
              ).flatMap((record) => (record.type === "message_end" ? [record.message] : []))
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
