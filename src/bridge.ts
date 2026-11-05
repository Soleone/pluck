import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Action = {
  id: string;
  name: string;
  key: string | null;
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

type Bridge = {
  /** Calls the listener each time the menu opens. Returns a function that stops listening. */
  onOpen(listener: (opened: Opened) => void): () => void;
  onRun(listener: (event: RunEvent) => void): () => void;
  run(actionId: string, run: number): Promise<void>;
  dismiss(): Promise<void>;
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
};

const sample: Opened = {
  text: "Die Grenzen meiner Sprache bedeuten die Grenzen meiner Welt.",
  app: "chrome",
  title: "Ludwig Wittgenstein - Wikipedia",
  actions: [
    { id: "explain", name: "Explain (Claude in WSL)", key: "e", output: "show" },
    { id: "translate", name: "Translate to English", key: "t", output: "notify" },
    { id: "search", name: "Search the web", key: "s", output: "notify" },
    { id: "bookmark", name: "Save as bookmark", key: "b", output: "notify" },
    { id: "count", name: "Count words", key: "w", output: "show" },
    { id: "upper", name: "Uppercase", key: "u", output: "copy" },
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
  };
}

export const bridge = isTauri() ? native : prototype();
