import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { bridge, type Action, type Opened } from "@/bridge";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

type Result = { action: Action; run: number; text: string; done: boolean; error: string | null };

/** The menu that opens on the hotkey, and the panel a `show` action streams into. */
export function Popup() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runCount = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      bridge.onOpen((next) => {
        setOpened(next);
        setOpenCount((count) => count + 1);
        setResult(null);
        setError(null);
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

  if (!opened) return null;

  function start(action: Action) {
    const run = ++runCount.current;
    if (action.output === "show") setResult({ action, run, text: "", done: false, error: null });
    bridge.run(action.id, run).catch((failure: unknown) => setError(String(failure)));
  }

  function runAccelerator(event: KeyboardEvent<HTMLInputElement>) {
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
          <Kbd>Esc</Kbd> to close
        </p>
      </div>
    );
  }

  return (
    <Command key={openCount} className="h-full">
      <div className="px-2 pt-1 pb-2">
        <p className="line-clamp-2 text-sm">{opened.text}</p>
        {opened.app && (
          <p className="truncate text-xs text-muted-foreground">
            {opened.app}
            {opened.title && ` · ${opened.title}`}
          </p>
        )}
      </div>
      <CommandInput ref={input} autoFocus placeholder="Filter actions" onKeyDown={runAccelerator} />
      <CommandList>
        <CommandEmpty>No matching action</CommandEmpty>
        {opened.actions.map((action) => (
          <CommandItem key={action.id} value={action.name} onSelect={() => start(action)}>
            {action.name}
            {action.key && <CommandShortcut>{action.key.toUpperCase()}</CommandShortcut>}
          </CommandItem>
        ))}
      </CommandList>
      {problems.map((problem) => (
        <p key={problem} className="px-2 py-1 text-xs text-destructive">
          {problem}
        </p>
      ))}
    </Command>
  );
}
