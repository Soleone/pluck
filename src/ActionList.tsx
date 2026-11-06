import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  FileCode,
  FolderOpen,
  Plus,
  Sparkles,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import { cn } from "cn";
import { bridge, type Action, type AgentSettings, type HomeState } from "@/bridge";
import { ActionIcon, OUTPUT_ICONS } from "@/ActionIcon";
import { ChoiceTiles } from "@/ChoiceTiles";
import { newId, suggestKey } from "@/menuActions";
import { ModelPicker, effectiveModel, loaded, harnessStart, type Catalog } from "@/ModelPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CodeInput } from "@/components/variants/CodeInput";
import { MenuContent } from "@/components/variants/MenuContent";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

const OUTPUTS = [
  { value: "show", label: "Panel", detail: "Shows the result in a panel" },
  { value: "replace", label: "Replace", detail: "Replaces the selection with the result" },
  { value: "copy", label: "Copy", detail: "Copies the result to the clipboard" },
  { value: "progress", label: "Progress", detail: "Shows a card while it runs, with Stop" },
  { value: "notify", label: "Notify", detail: "Only tells you when it's done" },
] as const;
const PROMPT_OUTPUTS = [
  { value: "session", label: "Session", detail: "Opens an agent session on the text" },
  ...OUTPUTS,
] as const;
const KINDS = [
  { value: "prompt", label: "Prompt", icon: Sparkles, hint: "The agent gets the text" },
  { value: "script", label: "Script", icon: SquareTerminal, hint: "Your command gets the text" },
];
const SCRIPT_INPUTS = [
  { what: "The selected text", names: ["stdin", "PLUCK_TEXT"] },
  { what: "Where it came from", names: ["PLUCK_APP", "PLUCK_TITLE", "PLUCK_URL"] },
];

/** The menu's actions, editable here and saved to pluck.toml. */
export function ActionList({
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
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus />
          New action
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
            <Ellipsis />
          </DropdownMenuTrigger>
          <MenuContent align="end">
            <DropdownMenuItem onClick={() => void bridge.openConfigFolder()}>
              <FolderOpen />
              Open folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void bridge.editConfig()}>
              <FileCode />
              Edit pluck.toml
            </DropdownMenuItem>
          </MenuContent>
        </DropdownMenu>
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
                : actions.map((action) => (action.id === editing.id ? saved : action)),
            )
          }
          onDelete={
            editing === "new"
              ? undefined
              : () => save(actions.filter((action) => action.id !== editing.id))
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
  // By id: the window reloads the actions on focus, so the objects change while the dialog is open.
  const others = actions.filter((other) => other.id !== action?.id);
  const [kind, setKind] = useState(action && !action.agent ? "script" : "prompt");
  const [name, setName] = useState(action?.name ?? "");
  /** Follows the name until it's typed, so a new action gets a free key on its own. */
  const [key, setKey] = useState<string | null>(action ? (action.key ?? "") : null);
  const [prompt, setPrompt] = useState(action?.agent ?? "");
  const [run, setRun] = useState(action?.run ?? "");
  const [scriptOutput, setScriptOutput] = useState<Action["output"]>(
    action && !action.agent ? action.output : "show",
  );
  const [promptOutput, setPromptOutput] = useState<Action["output"]>(
    action?.agent ? action.output : "session",
  );
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
  const settingsModel = known ? effectiveModel(known, agent, harnessStart(known)) : {};
  const valid = name.trim() !== "" && body.trim() !== "" && !keyOwner;

  const outputs = kind === "prompt" ? PROMPT_OUTPUTS : OUTPUTS;
  const output = kind === "prompt" ? promptOutput : scriptOutput;
  const setOutput = kind === "prompt" ? setPromptOutput : setScriptOutput;

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
      output,
      ...(kind === "prompt" ? model : { model: null, thinking: null }),
    }).then(onClose, (caught: unknown) => setProblem(String(caught)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={submit}
          onKeyDown={(event) =>
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            event.currentTarget.requestSubmit()
          }
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{action ? `Edit ${action.name}` : "New action"}</DialogTitle>
            <DialogDescription>How it shows in the menu:</DialogDescription>
            <MenuPreview
              name={name.trim()}
              shortcut={shownKey}
              agent={kind === "prompt"}
              output={output}
            />
          </DialogHeader>
          <ChoiceTiles label="Kind" value={kind} options={KINDS} onChange={setKind} />
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
          {/* Both kinds share one grid cell, so switching keeps the dialog's size. */}
          <div className="grid">
            <KindPane shown={kind === "prompt"}>
              <Field className="flex-1" data-invalid={checked && !prompt.trim()}>
                <FieldLabel htmlFor="action-prompt">Prompt</FieldLabel>
                <Textarea
                  id="action-prompt"
                  className="flex-1"
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
            </KindPane>
            <KindPane shown={kind === "script"}>
              <Field data-invalid={checked && !run.trim()}>
                <FieldLabel htmlFor="action-run">Command</FieldLabel>
                <CodeInput
                  id="action-run"
                  placeholder="scripts/translate.ps1"
                  value={run}
                  onChange={(event) => setRun(event.target.value)}
                />
                <FieldDescription>Runs in the config folder.</FieldDescription>
              </Field>
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-muted-foreground">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Terminal aria-hidden className="size-4 shrink-0" />
                  Your script gets
                </span>
                {SCRIPT_INPUTS.map(({ what, names }) => (
                  <span key={what} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-36">{what}</span>
                    {names.map((input) => (
                      <Badge key={input} variant="outline">
                        <code>{input}</code>
                      </Badge>
                    ))}
                  </span>
                ))}
                <span className="text-xs">What it prints is the result.</span>
              </div>
            </KindPane>
          </div>
          <Field>
            <FieldLabel>Output</FieldLabel>
            <ChoiceTiles
              label="Output"
              value={output}
              options={outputs.map((choice) => ({ ...choice, icon: OUTPUT_ICONS[choice.value] }))}
              onChange={(next) => setOutput(next as Action["output"])}
            />
            <FieldDescription>
              {outputs.find((choice) => choice.value === output)?.detail}
            </FieldDescription>
          </Field>
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
            <Button type="submit" title="Ctrl+Enter">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One kind's fields. A hidden one keeps its place, so both kinds take the height of the taller. */
function KindPane({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div
      inert={!shown}
      className={cn(
        "col-start-1 row-start-1 flex flex-col gap-4 transition-opacity",
        !shown && "invisible opacity-0",
      )}
    >
      {children}
    </div>
  );
}

/** The action as a row of the menu, updating while it's edited. */
function MenuPreview({
  name,
  shortcut,
  agent,
  output,
}: {
  name: string;
  shortcut: string;
  agent: boolean;
  output: Action["output"];
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-sm">
      <ActionIcon action={{ agent: agent ? "prompt" : null, output }} />
      <span className={cn("flex-1 truncate", !name && "text-muted-foreground")}>
        {name || "Untitled"}
      </span>
      {shortcut && <Kbd>{shortcut.toUpperCase()}</Kbd>}
    </div>
  );
}
