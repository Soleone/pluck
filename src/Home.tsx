import { useEffect, useState, type KeyboardEvent } from "react";
import { bridge, type AgentSettings, type HomeState, type Update } from "@/bridge";
import { ChoiceField } from "@/ChoiceField";
import { MenuTab } from "@/MenuTab";
import {
  ModelPicker,
  effectiveModel,
  loaded as loadedCatalog,
  modelName,
  piStart,
  type Catalog,
} from "@/ModelPicker";
import { hotkeyFromKeyDown, hotkeyKeys } from "@/hotkey";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The window behind the tray icon and the bare hotkey: settings and the menu's actions. */
export function Home() {
  const [state, setState] = useState<HomeState | null>(null);
  const [asked, setAsked] = useState<{ wsl: boolean; catalog: Catalog } | null>(null);
  const wsl = state?.wsl;
  const catalog = asked && asked.wsl === wsl ? asked.catalog : "loading";

  useEffect(() => {
    // pluck.toml may have been edited while the window was in the background.
    const load = () => void bridge.homeState().then(setState);
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  // Pi takes a few seconds to start, so ask it once the settings are known. WSL has its own Pi,
  // with its own models.
  useEffect(() => {
    if (wsl === undefined) return;
    bridge.agentCatalog().then(
      (catalog) => setAsked({ wsl, catalog }),
      (caught: unknown) => setAsked({ wsl, catalog: { error: errorText(caught) } }),
    );
  }, [wsl]);

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
          <span className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="menu">Menu</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={() => void bridge.showAgents()}>
              <Bot />
              Agents
            </Button>
          </span>
        </header>
        <TabsContent value="settings" className="min-h-0 overflow-auto">
          <div className="flex flex-col gap-4">
            <HotkeySetting
              hotkey={state.hotkey}
              platform={state.platform}
              onChange={(hotkey) => setState({ ...state, hotkey })}
            />
            <GeneralSetting state={state} onChange={setState} />
            <AgentSetting
              agent={state.agent}
              catalog={catalog}
              wsl={state.wsl}
              onChange={(agent) => setState({ ...state, agent })}
            />
            <p className="text-muted-foreground">Pluck {state.version}</p>
          </div>
        </TabsContent>
        <TabsContent value="menu" className="min-h-0 overflow-auto">
          <MenuTab
            state={state}
            catalog={catalog}
            onChange={(actions) => setState({ ...state, actions })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HotkeySetting({
  hotkey,
  platform,
  onChange,
}: {
  hotkey: string;
  platform: HomeState["platform"];
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

  if (platform === "linux")
    return (
      <section className="flex flex-col gap-1 rounded-lg border p-4">
        <span className="font-medium">Hotkey</span>
        <span className="text-muted-foreground">
          Wayland doesn't let apps grab keys, so bind one in your window manager to run{" "}
          <code>pluck menu</code>. In Hyprland: <code>bind = SUPER, P, exec, pluck menu</code>
        </span>
      </section>
    );

  const modifiers = platform === "macos" ? "Ctrl, Option or Cmd" : "Ctrl, Alt or Win";

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span id="hotkey-label" className="font-medium">
            Hotkey
          </span>
          <span className="text-muted-foreground">
            Opens the menu for the selected text, or for the clipboard when nothing is selected.
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
              {hotkeyKeys(hotkey, platform).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </Button>
      </div>
      <p className="text-muted-foreground">
        Click it, then press the new keys: {modifiers} with a letter, digit, F-key or Space. Escape
        keeps the current one.
      </p>
      {problem && (
        <p role="status" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

/** Starting at login, and on Windows whether scripts and agents run in WSL and whether to read
 * browser addresses. */
function GeneralSetting({
  state,
  onChange,
}: {
  state: HomeState;
  onChange: (state: HomeState) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  function change(next: HomeState, saved: Promise<void>) {
    setProblem(null);
    onChange(next);
    saved.catch((caught: unknown) => {
      onChange(state);
      setProblem(errorText(caught));
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <Field orientation="horizontal">
        <Checkbox
          id="autostart"
          checked={state.autostart}
          onCheckedChange={(autostart) =>
            change({ ...state, autostart }, bridge.setAutostart(autostart))
          }
        />
        <FieldLabel htmlFor="autostart">Start Pluck when you log in</FieldLabel>
      </Field>
      {state.platform === "windows" && (
        <Field orientation="horizontal">
          <Checkbox
            id="wsl"
            checked={state.wsl}
            onCheckedChange={(wsl) => change({ ...state, wsl }, bridge.setWsl(wsl))}
          />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="wsl">Run in WSL</FieldLabel>
            <FieldDescription>
              Scripts run in WSL's bash and agents use the Pi installed there, with WSL paths.
            </FieldDescription>
          </div>
        </Field>
      )}
      {state.platform === "windows" && (
        <Field orientation="horizontal">
          <Checkbox
            id="browser-url"
            checked={state.browserUrl}
            onCheckedChange={(browserUrl) =>
              change({ ...state, browserUrl }, bridge.setBrowserUrl(browserUrl))
            }
          />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="browser-url">
              In browsers, grab the URL when nothing is selected
            </FieldLabel>
            <FieldDescription>
              Pluck presses Ctrl+L, Ctrl+C and Esc to copy the address, then puts your clipboard
              back.
            </FieldDescription>
          </div>
        </Field>
      )}
      {problem && (
        <p role="status" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

/** The harness, model and thinking level new agent sessions use, and the folder they run in. */
function AgentSetting({
  agent,
  catalog,
  wsl,
  onChange,
}: {
  agent: AgentSettings;
  catalog: Catalog;
  wsl: boolean;
  onChange: (agent: AgentSettings) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [folder, setFolder] = useState(agent.folder);

  function save(next: AgentSettings) {
    setProblem(null);
    onChange(next);
    bridge.setAgentSettings(next).catch((caught: unknown) => setProblem(errorText(caught)));
  }

  const loaded = loadedCatalog(catalog);
  const session = loaded && effectiveModel(loaded, agent, piStart(loaded));

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Agent</span>
          <span className="text-muted-foreground">
            What agent actions and new sessions run. Running sessions keep their own.
          </span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-3">
        <ChoiceField
          id="agent-harness"
          label="Harness"
          value={agent.harness}
          options={[{ value: "pi", label: "Pi" }]}
          onChange={() => {}}
        />
        <div className="col-span-4">
          <ModelPicker
            catalog={catalog}
            value={agent}
            fallback={loaded ? piStart(loaded) : {}}
            fallbackLabel="Pi default"
            onChange={(model) => save({ ...agent, ...model })}
          />
        </div>
      </div>
      <Field>
        <FieldLabel htmlFor="agent-folder">Folder</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="agent-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            onBlur={() =>
              folder.trim() && folder !== agent.folder && save({ ...agent, folder: folder.trim() })
            }
          />
          <Button
            variant="outline"
            onClick={() =>
              void bridge.pickFolder().then((picked) => {
                if (!picked) return;
                setFolder(picked);
                save({ ...agent, folder: picked });
              })
            }
          >
            Choose…
          </Button>
        </div>
        <FieldDescription>
          Where new sessions work, like ~/src{wsl && " inside WSL"}.
        </FieldDescription>
      </Field>
      {catalog === "loading" && <p className="text-muted-foreground">Asking Pi for its models…</p>}
      {loaded && session?.model && (
        <p className="text-muted-foreground">
          New sessions use {modelName(loaded, session.model)}
          {session.thinking && ` with ${session.thinking} thinking`}.
        </p>
      )}
      {typeof catalog === "object" && "error" in catalog && (
        <p role="status" className="text-destructive">
          {catalog.error}
        </p>
      )}
      {problem && (
        <p role="status" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
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
