import { useEffect, useState, type KeyboardEvent } from "react";
import {
  bridge,
  type AgentCatalog,
  type AgentSettings,
  type HomeState,
  type Update,
} from "@/bridge";
import { modelChoices } from "@/agent/pi";
import { ChoiceField } from "@/ChoiceField";
import { hotkeyFromKeyDown, hotkeyKeys } from "@/hotkey";
import { Badge } from "@/components/ui/badge";
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
          <span className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="scripts">Scripts</TabsTrigger>
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
              // WSL has its own Pi, with its own models.
              key={String(state.wsl)}
              agent={state.agent}
              wsl={state.wsl}
              onChange={(agent) => setState({ ...state, agent })}
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

/** Starting at login, and on Windows whether scripts and agents run in WSL. */
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
      {problem && (
        <p role="status" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}

const DEFAULT = "default";

/** The harness, model and thinking level new agent sessions use, and the folder they run in. */
function AgentSetting({
  agent,
  wsl,
  onChange,
}: {
  agent: AgentSettings;
  wsl: boolean;
  onChange: (agent: AgentSettings) => void;
}) {
  const [catalog, setCatalog] = useState<AgentCatalog | "loading" | null>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [folder, setFolder] = useState(agent.folder);

  // Pi takes a few seconds to start, so ask it once, as soon as the settings show.
  useEffect(() => {
    bridge.agentCatalog().then(setCatalog, (caught: unknown) => {
      setCatalog(null);
      setProblem(errorText(caught));
    });
  }, []);

  function save(next: AgentSettings) {
    setProblem(null);
    onChange(next);
    bridge.setAgentSettings(next).catch((caught: unknown) => setProblem(errorText(caught)));
  }

  const loaded = catalog && catalog !== "loading" ? catalog : null;
  const choices = loaded ? modelChoices(loaded.models, loaded.settings) : [];
  const start = loaded?.start;
  const nameOf = (id: string) => choices.find((choice) => choice.id === id)?.name ?? id;
  const model = choices.find((choice) => choice.id === (agent.model ?? start?.model));
  const levels = model?.thinkingLevels ?? (agent.thinking ? [agent.thinking] : []);
  /** What Pi uses when pluck names no level: its start level, or the chosen model's own. */
  const piThinking = agent.model ? model?.thinking : start?.thinking;

  const models = [
    {
      value: DEFAULT,
      label: start ? `Pi default: ${nameOf(start.model)} · ${start.thinking}` : "Pi default",
    },
    ...choices.map((choice) => ({
      value: choice.id,
      label: `${choice.name} · ${choice.id.split("/")[0]} · ${choice.thinking}`,
    })),
  ];
  if (agent.model && !choices.some((choice) => choice.id === agent.model))
    models.push({ value: agent.model, label: agent.model });
  const thinking = [
    { value: DEFAULT, label: piThinking ? `Pi default: ${piThinking}` : "Pi default" },
    ...levels.map((level) => ({ value: level, label: level })),
  ];
  const sessionModel = agent.model ?? start?.model;
  const sessionThinking = agent.thinking ?? piThinking;

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
        <div className="col-span-2">
          <ChoiceField
            id="agent-model"
            label="Model"
            value={agent.model ?? DEFAULT}
            options={models}
            onChange={(value) => {
              const next = value === DEFAULT ? null : value;
              const nextLevels = choices.find(
                (choice) => choice.id === (next ?? start?.model),
              )?.thinkingLevels;
              const keepThinking = agent.thinking && nextLevels?.includes(agent.thinking);
              save({ ...agent, model: next, thinking: keepThinking ? agent.thinking : null });
            }}
          />
        </div>
        <div className="col-span-2">
          <ChoiceField
            id="agent-thinking"
            label="Thinking"
            value={agent.thinking ?? DEFAULT}
            options={thinking}
            onChange={(value) => save({ ...agent, thinking: value === DEFAULT ? null : value })}
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
      {loaded && sessionModel && (
        <p className="text-muted-foreground">
          New sessions use {nameOf(sessionModel)}
          {sessionThinking && ` with ${sessionThinking} thinking`}.
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
              <code
                className="truncate text-xs text-muted-foreground"
                title={action.agent ?? action.run}
              >
                {action.agent ?? action.run}
              </code>
            </div>
            <Badge variant="secondary">{action.agent ? "agent" : action.output}</Badge>
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
