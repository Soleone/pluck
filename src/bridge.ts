import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export type Action = {
  id: string;
  name: string;
  key: string | null;
  run: string;
  output: "show" | "copy" | "notify";
};

/** What the menu shows for one trigger. */
export type Opened = {
  text: string;
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
};

const ps = (script: string) =>
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\${script}.ps1`;

const sample: Opened = {
  text: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
  app: "chrome",
  title: "Ludwig Wittgenstein - Wikipedia",
  actions: [
    {
      id: "explain",
      name: "Explain (Claude in WSL)",
      key: "e",
      run: `wsl.exe -e bash -lc "claude -p 'Explain this briefly.'"`,
      output: "show",
    },
    {
      id: "translate",
      name: "Translate to English",
      key: "t",
      run: ps("translate"),
      output: "notify",
    },
    { id: "search", name: "Search the web", key: "s", run: ps("search"), output: "notify" },
    { id: "bookmark", name: "Save as bookmark", key: "b", run: ps("bookmark"), output: "notify" },
    { id: "count", name: "Count words", key: "w", run: ps("count"), output: "show" },
    { id: "upper", name: "Uppercase", key: "u", run: ps("upper"), output: "copy" },
  ],
  problems: [],
};

const cannedLines = [
  "Wittgenstein's line from the Tractatus: ",
  "the limits of my language mean the limits of my world.\n",
  "\nWhat we can't put into words, we can't really think about either.\n",
];

/** `pnpm dev:web`: sample text and actions, canned output, and the menu reopens after closing. */
function prototype(): Bridge {
  let hotkey = "Ctrl+Alt+Space";
  let openListener: ((opened: Opened) => void) | undefined;
  let runListener: ((event: RunEvent) => void) | undefined;
  const dismiss = async () => void setTimeout(() => openListener?.(sample), 500);

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
  };
}

export const bridge = isTauri() ? native : prototype();
