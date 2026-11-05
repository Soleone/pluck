import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

type Result = { action: Action; run: number; text: string; done: boolean; error: string | null };

/** The menu that opens on the hotkey, and the panel a `show` or `replace` action streams into. */
export function Popup() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Agent actions and questions go to the last session instead of a new one. */
  const [continueLast, setContinueLast] = useState(false);
  const runCount = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      bridge.onOpen((next) => {
        setOpened(next);
        setOpenCount((count) => count + 1);
        setResult(null);
        setError(null);
        setQuery("");
        setContinueLast(false);
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

  const fail = (failure: unknown) => setError(String(failure));
  const lastSession = opened.lastSession;
  const continuing = continueLast && lastSession !== null;
  const lastAge = lastSession?.lastActive ? ago(lastSession.lastActive) : null;

  function start(action: Action) {
    const run = ++runCount.current;
    if (action.output === "show" || action.output === "replace")
      setResult({ action, run, text: "", done: false, error: null });
    bridge.run(action.id, run, continuing).catch(fail);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && lastSession) {
      event.preventDefault();
      setContinueLast(!continueLast);
      return;
    }
    if (!opened || event.currentTarget.value || event.ctrlKey || event.altKey || event.metaKey)
      return;
    const action = opened.actions.find(
      (candidate) => candidate.key?.toLowerCase() === event.key.toLowerCase(),
    );
    if (!action) return;
    event.preventDefault();
    start(action);
  }

  const problems = error ? [...opened.problems, error] : opened.problems;

  if (result) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          {result.action.name}
          {result.done ? "" : " ..."}
        </p>
        <p className="flex-1 overflow-auto text-sm whitespace-pre-wrap">{result.text}</p>
        {[result.error, ...problems].filter(Boolean).map((problem) => (
          <p key={problem} className="text-xs text-destructive">
            {problem}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          {replacement !== null && (
            <>
              <Kbd>Enter</Kbd> {opened.clipboard ? "to copy" : "to replace the selection"} ·{" "}
            </>
          )}
          <Kbd>Esc</Kbd> to {replacement !== null ? "cancel" : "close"}
        </p>
      </div>
    );
  }

  const agentUsed = query.trim() !== "" || opened.actions.some((action) => action.agent);

  return (
    <Command key={openCount} className="h-full">
      <div className="px-2 pt-1 pb-2">
        <p className="line-clamp-2 text-sm">{opened.text}</p>
        {opened.clipboard ? (
          <p className="text-xs text-muted-foreground">From the clipboard</p>
        ) : (
          opened.app && (
            <p className="truncate text-xs text-muted-foreground">
              {opened.app}
              {opened.title && ` · ${opened.title}`}
            </p>
          )
        )}
      </div>
      <CommandInput
        ref={input}
        autoFocus
        placeholder="Filter actions, or Space to ask anything"
        value={query}
        onValueChange={setQuery}
        onKeyDown={onKeyDown}
      />
      <CommandList>
        {opened.actions.map((action) => (
          <CommandItem key={action.id} value={action.name} onSelect={() => start(action)}>
            {action.name}
            {action.key && <CommandShortcut>{action.key.toUpperCase()}</CommandShortcut>}
          </CommandItem>
        ))}
        {query.trim() && (
          <CommandItem
            forceMount
            value={`ask: ${query}`}
            onSelect={() => void bridge.ask(query.trim(), continuing).catch(fail)}
          >
            <span className="truncate">Ask: {query.trim()}</span>
          </CommandItem>
        )}
      </CommandList>
      {agentUsed && lastSession && (
        <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {continuing ? `Continues ${lastSession.title}` : "Agents start a new session"}
          </span>
          {continuing && lastAge && <span className="shrink-0">{lastAge}</span>}
          <span className="shrink-0">
            <Kbd>Tab</Kbd>{" "}
            {continuing ? "new session" : `continue last${lastAge ? ` (${lastAge})` : ""}`}
          </span>
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
