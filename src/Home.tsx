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
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
          </TabsList>
        </header>
        <TabsContent value="settings" className="min-h-0 overflow-auto">
          <div className="flex flex-col gap-4">
            <HotkeySetting
              hotkey={state.hotkey}
              onChange={(hotkey) => setState({ ...state, hotkey })}
            />
            <AgentSetting
              agent={state.agent}
              windows={state.windows}
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

const DEFAULT = "default";

/** The harness, model and thinking level new agent sessions use, and the folder they run in. */
function AgentSetting({
  agent,
  windows,
  onChange,
}: {
  agent: AgentSettings;
  windows: boolean;
  onChange: (agent: AgentSettings) => void;
}) {
  const [catalog, setCatalog] = useState<AgentCatalog | "loading" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [folder, setFolder] = useState(agent.folder);

  /** Pi has to start to list its models, so that waits until a list is opened. */
  function load() {
    if (catalog) return;
    setCatalog("loading");
    bridge.agentCatalog().then(setCatalog, (caught: unknown) => {
      setCatalog(null);
      setProblem(errorText(caught));
    });
  }

  function save(next: AgentSettings) {
    setProblem(null);
    onChange(next);
    bridge.setAgentSettings(next).catch((caught: unknown) => setProblem(errorText(caught)));
  }

  const loaded = catalog && catalog !== "loading" ? catalog : null;
  const choices = loaded ? modelChoices(loaded.models, loaded.settings) : [];
  const settings = loaded?.settings;
  const piModel =
    settings?.defaultProvider && settings.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : null;
  const model = choices.find((choice) => choice.id === (agent.model ?? piModel));
  const levels = model?.thinkingLevels ?? (agent.thinking ? [agent.thinking] : []);
  const piName = choices.find((choice) => choice.id === piModel)?.name ?? piModel;

  const models = [
    { value: DEFAULT, label: piName ? `Pi default (${piName})` : "Pi default" },
    ...choices.map((choice) => ({
      value: choice.id,
      label: `${choice.name} · ${choice.id.split("/")[0]}`,
    })),
  ];
  if (agent.model && !choices.some((choice) => choice.id === agent.model))
    models.push({ value: agent.model, label: agent.model });
  const thinking = [
    {
      value: DEFAULT,
      label: settings?.defaultThinkingLevel
        ? `Pi default (${settings.defaultThinkingLevel})`
        : "Pi default",
    },
    ...levels.map((level) => ({ value: level, label: level })),
  ];

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Agent</span>
          <span className="text-muted-foreground">
            What agent actions and new sessions run. Running sessions keep their own.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void bridge.showAgents()}>
          Open agents
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <ChoiceField
          id="agent-harness"
          label="Harness"
          value={agent.harness}
          options={[{ value: "pi", label: "Pi" }]}
          onChange={() => {}}
        />
        <ChoiceField
          id="agent-model"
          label="Model"
          value={agent.model ?? DEFAULT}
          options={models}
          onOpen={load}
          onChange={(value) => {
            const next = value === DEFAULT ? null : value;
            const nextLevels = choices.find(
              (choice) => choice.id === (next ?? piModel),
            )?.thinkingLevels;
            const keepThinking = agent.thinking && nextLevels?.includes(agent.thinking);
            save({ ...agent, model: next, thinking: keepThinking ? agent.thinking : null });
          }}
        />
        <ChoiceField
          id="agent-thinking"
          label="Thinking"
          value={agent.thinking ?? DEFAULT}
          options={thinking}
          onOpen={load}
          onChange={(value) => save({ ...agent, thinking: value === DEFAULT ? null : value })}
        />
      </div>
      {windows && (
        <Field orientation="horizontal">
          <Checkbox
            id="agent-wsl"
            checked={agent.wsl}
            onCheckedChange={(wsl) => {
              // WSL has its own Pi, with its own models.
              setCatalog(null);
              save({ ...agent, wsl });
            }}
          />
          <FieldLabel htmlFor="agent-wsl">Run in WSL</FieldLabel>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="agent-folder">Folder</FieldLabel>
        <Input
          id="agent-folder"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          onBlur={() =>
            folder.trim() && folder !== agent.folder && save({ ...agent, folder: folder.trim() })
          }
        />
        <FieldDescription>
          Where new sessions work, like ~/src{agent.wsl && " inside WSL"}.
        </FieldDescription>
      </Field>
      {catalog === "loading" && <p className="text-muted-foreground">Asking Pi for its models…</p>}
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
