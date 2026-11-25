import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Folder as FolderIcon,
  Sparkles,
} from "lucide-react";
import { ActionIcon } from "@/ActionIcon";
import { ago } from "@/agent/ago";
import { bridge, type Action, type Opened } from "@/bridge";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  countActions,
  entriesAt,
  entryId,
  folderPath,
  menuTree,
  type Entry,
  type Folder,
} from "@/menuActions";
import { play, snapshot, stop, type Shot } from "@/menuMotion";

/** `picked` while the typed question is being asked. */
const ASK = "pluck:ask";
/** How long a picked row plays its press before the action runs and the menu moves on. */
const PICK_MS = 160;
/** How long the menu says an action started before it closes and the action runs in the background. */
const STARTED_MS = 450;

const showsPanel = (action: Action) => action.output === "show" || action.output === "replace";
const runsInBackground = (action: Action) =>
  action.output === "copy" ||
  action.output === "notify" ||
  action.output === "progress" ||
  action.output === "none";

type Result = { action: Action; run: number; text: string; done: boolean; error: string | null };

/** `data-flight` of the path's last folder, where an opened folder's name flies to. */
const PATH = "path";

/** The menu that opens on the hotkey, and the panel a `show` or `replace` action streams into. */
export function Popup() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Agent actions and questions go to the last session instead of a new one. */
  const [continueLast, setContinueLast] = useState(false);
  /** The row being picked: it plays its press, then the action runs. */
  const [picked, setPicked] = useState<string | null>(null);
  /** A `copy`, `notify`, `progress` or `none` action, confirmed for a moment before the menu closes. */
  const [started, setStarted] = useState<Action | null>(null);
  /** The folders opened, outermost first. */
  const [path, setPath] = useState<string[]>([]);
  /** The highlighted row's value, so going up a level can highlight the folder it left. */
  const [selected, setSelected] = useState("");
  /** Moving between folders or filtering has happened since the menu opened; rows stop arriving. */
  const [navigated, setNavigated] = useState(false);
  const runCount = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const motion = useRef<{ shot: Shot; flightTo: string | null } | null>(null);

  useEffect(
    () =>
      bridge.onOpen((next) => {
        setOpened(next);
        setOpenCount((count) => count + 1);
        setResult(null);
        setError(null);
        setQuery("");
        setContinueLast(false);
        setPicked(null);
        setStarted(null);
        setPath([]);
        setSelected("");
        setNavigated(false);
        stop();
      }),
    [],
  );
  useEffect(
    () =>
      bridge.onRun((event) =>
        setResult((current) =>
          current?.run === event.run
            ? {
                ...current,
                text: current.text + (event.line ?? ""),
                done: event.done,
                error: event.error,
              }
            : current,
        ),
      ),
    [],
  );
  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) =>
      event.key === "Escape" && void bridge.dismiss();
    // The menu is created hidden, so autofocus alone misses the moment it's shown.
    const focusInput = () => input.current?.focus();
    window.addEventListener("keydown", close);
    window.addEventListener("focus", focusInput);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("focus", focusInput);
    };
  }, []);

  useLayoutEffect(() => {
    const pending = motion.current;
    motion.current = null;
    if (pending && list.current) play(pending.shot, list.current, pending.flightTo);
  }, [path, query]);

  /** A finished `replace` result goes in on Enter. */
  const replacement =
    result?.done && !result.error && result.action.output === "replace"
      ? result.text.replace(/\r?\n$/, "")
      : null;
  useEffect(() => {
    if (replacement === null) return;
    const accept = (event: globalThis.KeyboardEvent) =>
      event.key === "Enter" && void bridge.replace(replacement);
    window.addEventListener("keydown", accept);
    return () => window.removeEventListener("keydown", accept);
  }, [replacement]);

  if (!opened) return null;

  const fail = (failure: unknown) => {
    setPicked(null);
    setStarted(null);
    setError(String(failure));
  };
  const lastSession = opened.lastSession;
  const continuing = continueLast && lastSession !== null;
  const lastAge = lastSession?.lastActive ? ago(lastSession.lastActive) : null;

  function pick(id: string, then: () => void) {
    if (picked) return;
    setPicked(id);
    setTimeout(then, PICK_MS);
  }

  function start(action: Action) {
    pick(action.id, () => {
      const run = ++runCount.current;
      const go = () => void bridge.run(action.id, run, continuing).catch(fail);
      if (showsPanel(action)) setResult({ action, run, text: "", done: false, error: null });
      if (!runsInBackground(action)) return go();
      setStarted(action);
      setTimeout(go, STARTED_MS);
    });
  }

  /** Changes what the list shows, moving its rows from where they stood (`menu.folder-push`). */
  function change(
    update: () => void,
    flightFrom: string | null = null,
    flightTo: string | null = null,
  ) {
    const shot = list.current && snapshot(list.current, flightFrom);
    motion.current = shot ? { shot, flightTo } : null;
    setNavigated(true);
    update();
  }

  function open(folder: Folder) {
    const id = entryId(folder);
    change(
      () => {
        setPath(folder.path);
        setSelected(folder.entries[0] ? entryId(folder.entries[0]) : "");
      },
      id,
      PATH,
    );
  }

  function up() {
    const id = `folder:${path.join("/")}`;
    change(
      () => {
        setPath(path.slice(0, -1));
        setSelected(id);
      },
      PATH,
      id,
    );
  }

  function ask() {
    pick(ASK, () => void bridge.ask(query.trim(), continuing).catch(fail));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && lastSession) {
      event.preventDefault();
      setContinueLast(!continueLast);
      return;
    }
    if (event.currentTarget.value || event.ctrlKey || event.altKey || event.metaKey) return;
    const highlighted = entries.find((entry) => entryId(entry) === selected);
    if (path.length && ["Escape", "Backspace", "ArrowLeft"].includes(event.key)) {
      // Before the window's Escape, which would close the menu.
      event.stopPropagation();
      event.preventDefault();
      return up();
    }
    if (event.key === "ArrowRight" && highlighted?.kind === "folder") {
      event.preventDefault();
      return open(highlighted);
    }
    const entry = entries.find((candidate) => entryKey(candidate) === event.key.toLowerCase());
    if (!entry) return;
    event.preventDefault();
    if (entry.kind === "folder") open(entry);
    else start(entry.action);
  }

  const problems = error ? [...opened.problems, error] : opened.problems;

  if (started) {
    return (
      <div data-menu-panel className="flex h-full items-center justify-center gap-2 text-sm">
        <CircleCheck aria-hidden className="menu-done size-4 text-primary" />
        {started.name} started
      </div>
    );
  }

  if (result) {
    return (
      <div data-menu-panel className="flex h-full flex-col gap-2 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ActionIcon action={result.action} />
          <span className={result.done ? undefined : "shimmer motion-reduce:shimmer-none"}>
            {result.action.name}
          </span>
          {result.done && !result.error && (
            <CircleCheck aria-label="Done" className="menu-done size-3.5 text-primary" />
          )}
        </p>
        <p className="flex-1 overflow-auto text-sm whitespace-pre-wrap">{result.text}</p>
        {[result.error, ...problems].filter(Boolean).map((problem) => (
          <p key={problem} className="text-xs text-destructive">
            {problem}
          </p>
        ))}
        <p className="flex gap-3 text-xs text-muted-foreground">
          {replacement !== null && (
            <button type="button" onClick={() => void bridge.replace(replacement)}>
              <Kbd>Enter</Kbd>{" "}
              {opened.source === "selection" ? "to replace the selection" : "to copy"}
            </button>
          )}
          <button type="button" onClick={() => void bridge.dismiss()}>
            <Kbd>Esc</Kbd> to {replacement !== null ? "cancel" : "close"}
          </button>
        </p>
      </div>
    );
  }

  const filter = query.trim().toLowerCase();
  const entries: Entry[] = filter
    ? opened.actions
        .filter((action) =>
          [...folderPath(action), action.name].join(" ").toLowerCase().includes(filter),
        )
        .map((action) => ({ kind: "action", action }))
    : entriesAt(menuTree(opened.actions), path);

  const agentUsed = query.trim() !== "" || opened.actions.some((action) => action.agent);

  return (
    <Command
      key={openCount}
      data-menu
      data-picking={picked !== null}
      data-navigated={navigated || undefined}
      className="h-full"
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
    >
      <div className="px-2 pt-1 pb-2">
        <p className="line-clamp-2 text-sm">{opened.text}</p>
        {opened.source === "clipboard" ? (
          <p className="text-xs text-muted-foreground">From the clipboard</p>
        ) : (
          opened.app && (
            <p className="truncate text-xs text-muted-foreground">{sourceName(opened)}</p>
          )
        )}
      </div>
      <CommandInput
        ref={input}
        autoFocus
        placeholder="Filter actions, or Space to ask anything"
        value={query}
        onValueChange={(next) => change(() => setQuery(next))}
        onKeyDown={onKeyDown}
      />
      {path.length > 0 && !filter && (
        <button
          type="button"
          title="Back (←)"
          onMouseDown={keepFocus}
          onClick={up}
          className="flex items-center gap-1 self-start rounded-md px-1 pt-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {path.map((name, index) => (
            <Fragment key={name}>
              {index > 0 && <ChevronRight aria-hidden className="size-3" />}
              {index === path.length - 1 ? (
                <span data-flight={PATH} className="font-medium text-foreground">
                  {name}
                </span>
              ) : (
                name
              )}
            </Fragment>
          ))}
        </button>
      )}
      <CommandList ref={list}>
        {entries.map((entry) => {
          const id = entryId(entry);
          const key = entryKey(entry);
          return (
            <CommandItem
              key={id}
              value={id}
              data-row={id}
              data-picked={picked === id || undefined}
              onSelect={() => (entry.kind === "folder" ? open(entry) : start(entry.action))}
            >
              {entry.kind === "folder" ? (
                <>
                  <FolderIcon aria-hidden />
                  <span data-flight={id} className="flex-1 truncate">
                    {entry.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{countActions(entry)}</span>
                  <ChevronRight aria-hidden className="text-muted-foreground" />
                </>
              ) : (
                <>
                  <ActionIcon action={entry.action} />
                  <span className="truncate">
                    {filter && entry.action.folder && (
                      <span className="text-muted-foreground">
                        {folderPath(entry.action).join(" › ")} ›{" "}
                      </span>
                    )}
                    {entry.action.name}
                  </span>
                </>
              )}
              {key && !filter && (
                <CommandShortcut>
                  <Kbd>{key.toUpperCase()}</Kbd>
                </CommandShortcut>
              )}
            </CommandItem>
          );
        })}
        {query.trim() && (
          <CommandItem
            forceMount
            value={`ask: ${query}`}
            data-picked={picked === ASK || undefined}
            onSelect={ask}
          >
            <Sparkles aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              <span className="text-muted-foreground">Ask</span> {query.trim()}
            </span>
          </CommandItem>
        )}
      </CommandList>
      {agentUsed && lastSession && (
        <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {continuing && `Continues ${lastSession.title}`}
          </span>
          {continuing && lastAge && <span className="shrink-0">{lastAge}</span>}
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setContinueLast(!continueLast)}
            className="shrink-0 hover:text-foreground"
          >
            <Kbd>Tab</Kbd>{" "}
            {continuing
              ? "new session"
              : lastAge
                ? `resume session from ${lastAge}`
                : "resume last session"}
          </button>
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="px-2 py-1 text-xs text-destructive">
          {problem}
        </p>
      ))}
    </Command>
  );
}

const entryKey = (entry: Entry) =>
  entry.kind === "folder" ? entry.key : (entry.action.key?.toLowerCase() ?? "");

/** Clicking a hint leaves focus in the filter, where the menu's keys work. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** The app and its window title, or the title alone when it already names the app, like "Factory - Brave". */
const sourceName = ({ app, title }: Opened) =>
  !title ? app : title.toLowerCase().includes(app.toLowerCase()) ? title : `${app} · ${title}`;
