import { useEffect, useState, type KeyboardEvent } from "react";
import { bridge, type HomeState, type Update } from "@/bridge";
import { hotkeyFromKeyDown, hotkeyKeys } from "@/hotkey";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The window behind the tray icon and the bare hotkey: settings and the configured scripts. */
export function Home() {
  const [state, setState] = useState<HomeState | null>(null);

  useEffect(() => {
    // pluck.toml may have been edited while the window was in the background.
    const load = () => void bridge.homeState().then(setState);
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  if (!state) return null;

  return (
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <Tabs defaultValue="settings" className="m-4 min-h-0 flex-1">
        <header className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-heading font-medium">
            <img src="/favicon.svg" alt="" className="size-5" />
            Pluck
          </span>
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
          </TabsList>
        </header>
        <TabsContent value="settings">
          <div className="flex flex-col gap-4">
            <HotkeySetting
              hotkey={state.hotkey}
              onChange={(hotkey) => setState({ ...state, hotkey })}
            />
            <p className="text-muted-foreground">Pluck {state.version}</p>
          </div>
        </TabsContent>
        <TabsContent value="scripts" className="min-h-0 overflow-auto">
          <Scripts state={state} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HotkeySetting({
  hotkey,
  onChange,
}: {
  hotkey: string;
  onChange: (hotkey: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function start() {
    setProblem(null);
    setRecording(true);
    void bridge.pauseHotkey();
  }

  /** Registers `next`, or the current hotkey again when recording is abandoned. */
  function finish(next: string) {
    setRecording(false);
    bridge.setHotkey(next).then(
      () => onChange(next),
      (caught: unknown) => setProblem(errorText(caught)),
    );
  }

  function record(event: KeyboardEvent) {
    if (!recording || event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") return finish(hotkey);
    const next = hotkeyFromKeyDown(event.nativeEvent);
    if (next) finish(next);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span id="hotkey-label" className="font-medium">
            Hotkey
          </span>
          <span className="text-muted-foreground">
            Opens the menu for the selected text, or this window when nothing is selected.
          </span>
        </div>
        <Button
          variant="outline"
          className="min-w-36"
          aria-labelledby="hotkey-label"
          aria-pressed={recording}
          onClick={() => (recording ? finish(hotkey) : start())}
          onBlur={() => recording && finish(hotkey)}
          onKeyDown={record}
        >
          {recording ? (
            <span className="text-muted-foreground">Press keys…</span>
          ) : (
            <KbdGroup>
              {hotkeyKeys(hotkey).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </Button>
      </div>
      <p className="text-muted-foreground">
        Click it, then press the new keys: Ctrl, Alt or Win with a letter, digit, F-key or Space.
        Escape keeps the current one.
      </p>
      {problem && (
        <p role="status" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

function Scripts({ state }: { state: HomeState }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="truncate text-muted-foreground" title={state.configDir}>
          The menu's actions, from pluck.toml in {state.configDir}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void bridge.openConfigFolder()}>
            Open folder
          </Button>
          <Button size="sm" onClick={() => void bridge.editConfig()}>
            Edit pluck.toml
          </Button>
        </div>
      </div>
      {state.problems.map((problem) => (
        <p key={problem} className="text-destructive">
          {problem}
        </p>
      ))}
      <ul className="flex flex-col divide-y rounded-lg border">
        {state.actions.map((action) => (
          <li key={action.id} className="flex items-center gap-3 px-3 py-2">
            <span className="flex w-6 justify-center">
              {action.key && <Kbd>{action.key.toUpperCase()}</Kbd>}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{action.name}</span>
              <code className="truncate text-xs text-muted-foreground" title={action.run}>
                {action.run}
              </code>
            </div>
            <Badge variant="secondary">{action.output}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Checked once per start; pluck keeps running in the tray, so the window may open much later. */
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => void bridge.availableUpdate().then(setUpdate), []);

  if (!update) return null;

  function install() {
    if (!update) return;
    setInstalling(true);
    setFailure(null);
    update.install().catch((caught: unknown) => {
      setInstalling(false);
      setFailure(`Couldn't update: ${errorText(caught)}`);
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-muted px-4 py-2">
      <span>
        {installing
          ? `Updating to Pluck ${update.version}…`
          : (failure ?? `Pluck ${update.version} is available`)}
      </span>
      <Button size="sm" disabled={installing} onClick={install}>
        {failure ? "Retry" : "Update"}
      </Button>
    </div>
  );
}
