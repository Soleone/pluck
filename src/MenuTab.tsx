import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { bridge, type Action, type AgentSettings, type HomeState } from "@/bridge";
import { ActionIcon } from "@/ActionIcon";
import { ChoiceField } from "@/ChoiceField";
import { newId, suggestKey } from "@/menuActions";
import { ModelPicker, effectiveModel, loaded, piStart, type Catalog } from "@/ModelPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const OUTPUTS = [
  { value: "show", label: "Show in a panel" },
  { value: "replace", label: "Replace the selection" },
  { value: "copy", label: "Copy to the clipboard" },
  { value: "notify", label: "Notify when done" },
];

/** The menu's actions, editable here and saved to pluck.toml. */
export function MenuTab({
  state,
  catalog,
  onChange,
}: {
  state: HomeState;
  catalog: Catalog;
  onChange: (actions: Action[]) => void;
}) {
  /** The action in the dialog: an existing one, a new one, or none while closed. */
  const [editing, setEditing] = useState<Action | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const actions = state.actions;

  async function save(next: Action[]) {
    await bridge.saveActions(next);
    setProblem(null);
    onChange(next);
  }

  function move(index: number, by: number) {
    const next = [...actions];
    next.splice(index + by, 0, ...next.splice(index, 1));
    save(next).catch((caught: unknown) => setProblem(String(caught)));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="truncate text-muted-foreground" title={state.configDir}>
          What the menu offers, saved to pluck.toml in {state.configDir}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void bridge.openConfigFolder()}>
            Open folder
          </Button>
          <Button variant="outline" size="sm" onClick={() => void bridge.editConfig()}>
            Edit pluck.toml
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            New action
          </Button>
        </div>
      </div>
      {[...state.problems, problem].filter(Boolean).map((line) => (
        <p key={line} className="text-destructive">
          {line}
        </p>
      ))}
      <ul className="flex flex-col divide-y rounded-lg border">
        {actions.map((action, index) => (
          <li key={action.id} className="group flex items-center gap-3 px-3 py-2">
            <span className="flex w-6 justify-center">
              {action.key && <Kbd>{action.key.toUpperCase()}</Kbd>}
            </span>
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start text-left"
              onClick={() => setEditing(action)}
            >
              <span className="flex items-center gap-2 font-medium">
                <ActionIcon action={action} />
                {action.name}
              </span>
              {action.agent ? (
                <span className="w-full truncate text-xs text-muted-foreground">
                  {action.agent}
                </span>
              ) : (
                <code className="w-full truncate text-xs text-muted-foreground">{action.run}</code>
              )}
            </button>
            <Badge variant="secondary">{action.agent ? "prompt" : action.output}</Badge>
            <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${action.name} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${action.name} down`}
                disabled={index === actions.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <ActionDialog
          action={editing === "new" ? null : editing}
          actions={actions}
          agent={state.agent}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSave={(saved) =>
            save(
              editing === "new"
                ? [...actions, saved]
                : actions.map((action) => (action === editing ? saved : action)),
            )
          }
          onDelete={
            editing === "new"
              ? undefined
              : () => save(actions.filter((action) => action !== editing))
          }
        />
      )}
    </div>
  );
}

/** Edits one action, or makes a new one when `action` is null. A new one starts as a prompt. */
function ActionDialog({
  action,
  actions,
  agent,
  catalog,
  onClose,
  onSave,
  onDelete,
}: {
  action: Action | null;
  actions: Action[];
  agent: AgentSettings;
  catalog: Catalog;
  onClose: () => void;
  onSave: (action: Action) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const others = actions.filter((other) => other !== action);
  const [kind, setKind] = useState(action && !action.agent ? "script" : "prompt");
  const [name, setName] = useState(action?.name ?? "");
  /** Follows the name until it's typed, so a new action gets a free key on its own. */
  const [key, setKey] = useState<string | null>(action ? (action.key ?? "") : null);
  const [prompt, setPrompt] = useState(action?.agent ?? "");
  const [run, setRun] = useState(action?.run ?? "");
  const [output, setOutput] = useState<Action["output"]>(action?.output ?? "show");
  const [interactive, setInteractive] = useState(action?.interactive ?? true);
  const [model, setModel] = useState({
    model: action?.model ?? null,
    thinking: action?.thinking ?? null,
  });
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shownKey = key ?? suggestKey(name, others);
  const keyOwner = shownKey
    ? others.find((other) => other.key?.toLowerCase() === shownKey.toLowerCase())
    : undefined;
  const body = kind === "prompt" ? prompt : run;
  const known = loaded(catalog);
  const settingsModel = known ? effectiveModel(known, agent, piStart(known)) : {};
  const valid = name.trim() !== "" && body.trim() !== "" && !keyOwner;

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (!valid) return;
    const trimmed = name.trim();
    onSave({
      id: action?.id ?? newId(trimmed, actions),
      name: trimmed,
      key: shownKey.toLowerCase() || null,
      run: kind === "script" ? run.trim() : "",
      agent: kind === "prompt" ? prompt.trim() : null,
      output: kind === "script" ? output : "notify",
      interactive: kind === "script" || interactive,
      ...(kind === "prompt" ? model : { model: null, thinking: null }),
    }).then(onClose, (caught: unknown) => setProblem(String(caught)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{action ? `Edit ${action.name}` : "New action"}</DialogTitle>
            <DialogDescription>
              A prompt sends the text to the agent. A script runs your own command.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={kind} onValueChange={setKind}>
            <TabsList>
              <TabsTrigger value="prompt">Prompt</TabsTrigger>
              <TabsTrigger value="script">Script</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-4 gap-3">
            <Field className="col-span-3" data-invalid={checked && !name.trim()}>
              <FieldLabel htmlFor="action-name">Name</FieldLabel>
              <Input
                id="action-name"
                autoFocus
                placeholder={kind === "prompt" ? "Understand" : "Translate"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field data-invalid={Boolean(keyOwner)}>
              <FieldLabel htmlFor="action-key">Key</FieldLabel>
              <Input
                id="action-key"
                maxLength={1}
                value={shownKey.toUpperCase()}
                onChange={(event) => setKey(event.target.value.trim())}
              />
            </Field>
          </div>
          {keyOwner && (
            <FieldError>
              {shownKey.toUpperCase()} already runs {keyOwner.name}.
            </FieldError>
          )}
          {kind === "prompt" ? (
            <>
              <Field data-invalid={checked && !prompt.trim()}>
                <FieldLabel htmlFor="action-prompt">Prompt</FieldLabel>
                <Textarea
                  id="action-prompt"
                  rows={5}
                  placeholder="Give me all the context I need to understand this concept. Use visuals where they help."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <FieldDescription>
                  The agent gets it with the selected text and where it came from.
                </FieldDescription>
              </Field>
              <ModelPicker
                catalog={catalog}
                value={model}
                fallback={settingsModel}
                fallbackLabel="Settings"
                onChange={setModel}
              />
              <Field orientation="horizontal">
                <Checkbox
                  id="action-interactive"
                  checked={interactive}
                  onCheckedChange={setInteractive}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="action-interactive">Interactive agent session</FieldLabel>
                  <FieldDescription>
                    {interactive
                      ? "Opens a session you can keep talking to."
                      : "Shows a one-off reply in the menu."}
                  </FieldDescription>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field data-invalid={checked && !run.trim()}>
                <FieldLabel htmlFor="action-run">Command</FieldLabel>
                <Input
                  id="action-run"
                  placeholder="scripts/translate.ps1"
                  value={run}
                  onChange={(event) => setRun(event.target.value)}
                />
                <FieldDescription>
                  Runs in the config folder with the selected text on stdin.
                </FieldDescription>
              </Field>
              <ChoiceField
                id="action-output"
                label="Output"
                value={output}
                options={OUTPUTS}
                onChange={(next) => setOutput(next as Action["output"])}
              />
            </>
          )}
          {problem && <FieldError>{problem}</FieldError>}
          <DialogFooter>
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  onDelete().then(onClose, (caught: unknown) => setProblem(String(caught)))
                }
              >
                Delete
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
