import { useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Ellipsis,
  FileCode,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  SquareTerminal,
  Terminal,
  Ungroup,
} from "lucide-react";
import { cn } from "cn";
import { bridge, type Action, type AgentSettings, type HomeState } from "@/bridge";
import { ActionIcon, OUTPUT_ICONS } from "@/ActionIcon";
import { ChoiceTiles } from "@/ChoiceTiles";
import { ChoiceField } from "@/ChoiceField";
import {
  countActions,
  entryId,
  folderPath,
  folderPaths,
  menuTree,
  moveEntry,
  moveEntryTo,
  newId,
  renameFolder,
  suggestKey,
  ungroup,
  type Entry,
} from "@/menuActions";
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
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  { value: "none", label: "Silent", detail: "Shows nothing unless it fails" },
] as const;
const PROMPT_OUTPUTS = [
  { value: "session", label: "Session", detail: "Opens an agent session on the text" },
  ...OUTPUTS,
] as const;
const KINDS = [
  { value: "prompt", label: "Prompt", icon: Sparkles, hint: "The agent gets the text" },
  { value: "script", label: "Script", icon: SquareTerminal, hint: "Your command gets the text" },
];
/** The Folder field's choices besides the folders themselves; no folder path can be either. */
const TOP_LEVEL = "/";
const NEW_FOLDER = "/new";

/** Where a dragged row lands, relative to the row it's over. */
type Drop = { id: string; place: "before" | "after" | "into" };

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
  /** The action in the dialog: an existing one, a new one, one being described to the agent, or
   * none while closed. */
  const [editing, setEditing] = useState<Action | "new" | "describe" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Folders closed in this list, by entry id; the menu is unaffected. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** The folder being renamed, or the entry being moved into a new folder. */
  const [naming, setNaming] = useState<
    { rename: string[] } | { move: string; parent: string[] } | null
  >(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const actions = state.actions;
  const folders = folderPaths(actions);

  async function save(next: Action[]) {
    await bridge.saveActions(next);
    setProblem(null);
    onChange(next);
  }

  function change(next: Action[]) {
    if (next !== actions) save(next).catch((caught: unknown) => setProblem(String(caught)));
  }

  function dragOver(event: DragEvent<HTMLElement>, entry: Entry) {
    const id = entryId(entry);
    if (!dragging || dragging === id) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientY - box.top) / box.height;
    const place =
      entry.kind === "folder"
        ? share < 0.3
          ? "before"
          : "into"
        : share < 0.5
          ? "before"
          : "after";
    if (drop?.id !== id || drop.place !== place) setDrop({ id, place });
  }

  function dropOn(event: DragEvent<HTMLElement>, entry: Entry) {
    event.preventDefault();
    event.stopPropagation();
    if (dragging && drop)
      change(
        moveEntryTo(
          actions,
          dragging,
          drop.place === "into" && entry.kind === "folder"
            ? { into: entry.path }
            : { beside: drop.id, after: drop.place === "after" },
        ),
      );
    setDragging(null);
    setDrop(null);
  }

  /** What makes a row a place to drop on. */
  function rowProps(entry: Entry) {
    const id = entryId(entry);
    return {
      "data-drop": drop?.id === id ? drop.place : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => dragOver(event, entry),
      onDrop: (event: DragEvent<HTMLElement>) => dropOn(event, entry),
    };
  }

  function dragProps(entry: Entry) {
    const id = entryId(entry);
    return {
      draggable: true,
      "data-dragging": dragging === id || undefined,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        setDragging(id);
      },
      onDragEnd: () => {
        setDragging(null);
        setDrop(null);
      },
    };
  }

  function rowTools(entry: Entry, siblings: Entry[], parent: string[]) {
    const id = entryId(entry);
    const index = siblings.indexOf(entry);
    const own = entry.kind === "folder" ? entry.path.join("/") : null;
    const targets = folders.filter(
      (folder) => own === null || (folder !== own && !folder.startsWith(`${own}/`)),
    );
    const name = entry.kind === "folder" ? entry.name : entry.action.name;
    return (
      <span className="flex opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} up`}
          disabled={index === 0}
          onClick={() => change(moveEntry(actions, id, -1))}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} down`}
          disabled={index === siblings.length - 1}
          onClick={() => change(moveEntry(actions, id, 1))}
        >
          <ArrowDown />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`} />}
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <MenuContent align="end">
            {entry.kind === "folder" && (
              <>
                <DropdownMenuItem onClick={() => setNaming({ rename: entry.path })}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => change(ungroup(actions, entry.path))}>
                  <Ungroup />
                  Ungroup
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={parent.length === 0}
                onClick={() => change(moveEntryTo(actions, id, { into: [] }))}
              >
                <CornerLeftUp />
                Top level
              </DropdownMenuItem>
              {targets.map((folder) => (
                <DropdownMenuItem
                  key={folder}
                  disabled={folder === parent.join("/")}
                  onClick={() => change(moveEntryTo(actions, id, { into: folder.split("/") }))}
                >
                  <Folder />
                  {folder.split("/").join(" › ")}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => setNaming({ move: id, parent })}>
                <FolderPlus />
                New folder…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MenuContent>
        </DropdownMenu>
      </span>
    );
  }

  function rows(entries: Entry[], parent: string[]): ReactNode {
    return entries.map((entry) => {
      const id = entryId(entry);
      if (entry.kind === "folder") {
        const open = !collapsed.has(id);
        const Toggle = open ? ChevronDown : ChevronRight;
        return (
          <li key={id} className="flex flex-col" {...dragProps(entry)}>
            <div className="group/row flex items-center gap-3 px-3 py-2" {...rowProps(entry)}>
              <GripVertical
                aria-hidden
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
              />
              <span className="flex w-6 justify-center">
                {entry.key && <Kbd>{entry.key.toUpperCase()}</Kbd>}
              </span>
              <button
                type="button"
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 text-left font-medium"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (open) next.add(id);
                  else next.delete(id);
                  setCollapsed(next);
                }}
              >
                <Toggle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {countActions(entry)}
                </span>
              </button>
              {rowTools(entry, entries, parent)}
            </div>
            {open && (
              <ul className="ml-9 flex flex-col divide-y border-t border-l">
                {rows(entry.entries, entry.path)}
              </ul>
            )}
          </li>
        );
      }
      const { action } = entry;
      return (
        <li
          key={id}
          className="group/row flex items-center gap-3 px-3 py-2"
          {...dragProps(entry)}
          {...rowProps(entry)}
        >
          <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-muted-foreground" />
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
              <span className="w-full truncate text-xs text-muted-foreground">{action.agent}</span>
            ) : (
              <code className="w-full truncate text-xs text-muted-foreground">{action.run}</code>
            )}
          </button>
          <Badge variant="secondary">{action.agent ? "prompt" : action.output}</Badge>
          {rowTools(entry, entries, parent)}
        </li>
      );
    });
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
      <ul className="flex flex-col divide-y rounded-lg border">{rows(menuTree(actions), [])}</ul>
      {naming && (
        <FolderNameDialog
          initial={"rename" in naming ? (naming.rename.at(-1) ?? "") : ""}
          renaming={"rename" in naming}
          onClose={() => setNaming(null)}
          onSave={(name) =>
            save(
              "rename" in naming
                ? renameFolder(actions, naming.rename, name)
                : moveEntryTo(actions, naming.move, { into: [...naming.parent, name] }),
            )
          }
        />
      )}
      {editing === "describe" && <DescribeDialog onClose={() => setEditing(null)} />}
      {editing && editing !== "describe" && (
        <ActionDialog
          action={editing === "new" ? null : editing}
          actions={actions}
          agent={state.agent}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            const replace = (list: Action[]) =>
              list.map((action) => (action.id === saved.id ? saved : action));
            return save(
              editing === "new"
                ? [...actions, saved]
                : saved.folder === editing.folder
                  ? replace(actions)
                  : replace(moveEntryTo(actions, saved.id, { into: folderPath(saved) })),
            );
          }}
          onDelete={
            editing === "new"
              ? undefined
              : () => save(actions.filter((action) => action.id !== editing.id))
          }
          onDescribe={editing === "new" ? () => setEditing("describe") : undefined}
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
  onDescribe,
}: {
  action: Action | null;
  actions: Action[];
  agent: AgentSettings;
  catalog: Catalog;
  onClose: () => void;
  onSave: (action: Action) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDescribe?: () => void;
}) {
  // By id: the window reloads the actions on focus, so the objects change while the dialog is open.
  const [folder, setFolder] = useState(action?.folder ?? TOP_LEVEL);
  const [newFolder, setNewFolder] = useState("");
  const chosenFolder =
    folder === NEW_FOLDER ? newFolder.trim() || null : folder === TOP_LEVEL ? null : folder;
  // Keys only need to be free among the actions in the same folder.
  const others = actions.filter(
    (other) => other.id !== action?.id && other.folder === chosenFolder,
  );
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

  const shownKey =
    key ??
    suggestKey(
      name,
      others.map((other) => other.key),
    );
  const keyOwner = shownKey
    ? others.find((other) => other.key?.toLowerCase() === shownKey.toLowerCase())
    : undefined;
  const body = kind === "prompt" ? prompt : run;
  const known = loaded(catalog);
  const settingsModel = known ? effectiveModel(known, agent, harnessStart(known)) : {};
  const valid =
    name.trim() !== "" &&
    body.trim() !== "" &&
    !keyOwner &&
    (folder !== NEW_FOLDER || chosenFolder !== null);

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
      folder: chosenFolder,
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
              folder={chosenFolder}
              name={name.trim()}
              shortcut={shownKey}
              agent={kind === "prompt"}
              output={output}
            />
          </DialogHeader>
          <ChoiceTiles label="Kind" value={kind} options={KINDS} onChange={setKind} />
          <div className="grid grid-cols-6 gap-3">
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
            <div className="col-span-2">
              <ChoiceField
                id="action-folder"
                label="Folder"
                value={folder}
                options={[
                  { value: TOP_LEVEL, label: "Top level" },
                  ...folderPaths(actions).map((path) => ({
                    value: path,
                    label: path.split("/").join(" › "),
                  })),
                  { value: NEW_FOLDER, label: "New folder…" },
                ]}
                onChange={setFolder}
              />
            </div>
            {folder === NEW_FOLDER && (
              <Field className="col-span-6" data-invalid={checked && chosenFolder === null}>
                <FieldLabel htmlFor="action-new-folder">New folder</FieldLabel>
                <Input
                  id="action-new-folder"
                  autoFocus
                  placeholder="Translate"
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                />
              </Field>
            )}
          </div>
          {keyOwner && (
            <FieldError>
              {shownKey.toUpperCase()} already runs {keyOwner.name}
              {chosenFolder ? ` in ${chosenFolder.split("/").join(" › ")}` : ""}.
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
            {onDescribe && (
              <Button type="button" variant="ghost" onClick={onDescribe}>
                <Bot />
                Create with agent
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

/** Asks what a new action should do and hands that to a new agent session, which builds it. */
function DescribeDialog({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    bridge
      .createAction(description.trim())
      .then(onClose, (caught: unknown) => setProblem(String(caught)));
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
            <DialogTitle>Create with agent</DialogTitle>
            <DialogDescription>
              An agent session opens, writes the action and its script, and tries it.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="action-description">What should it do?</FieldLabel>
            <Textarea
              id="action-description"
              autoFocus
              rows={5}
              placeholder="Turn the selected text into a markdown link to the page it came from, and replace the selection with it."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {problem && <FieldError>{problem}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" title="Ctrl+Enter" disabled={!description.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Names a new folder, or renames one. */
function FolderNameDialog({
  initial,
  renaming,
  onClose,
  onSave,
}: {
  initial: string;
  renaming: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(name.trim()).then(onClose, (caught: unknown) => setProblem(String(caught)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{renaming ? `Rename ${initial}` : "New folder"}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="folder-name">Name</FieldLabel>
            <Input
              id="folder-name"
              autoFocus
              placeholder="Translate"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {problem && <FieldError>{problem}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || name.includes("/")}>
              {renaming ? "Rename" : "Create"}
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
  folder,
  name,
  shortcut,
  agent,
  output,
}: {
  folder: string | null;
  name: string;
  shortcut: string;
  agent: boolean;
  output: Action["output"];
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-sm">
      <ActionIcon action={{ agent: agent ? "prompt" : null, output }} />
      <span className={cn("flex-1 truncate", !name && "text-muted-foreground")}>
        {folder && (
          <span className="text-muted-foreground">{folder.split("/").join(" › ")} › </span>
        )}
        {name || "Untitled"}
      </span>
      {shortcut && <Kbd>{shortcut.toUpperCase()}</Kbd>}
    </div>
  );
}
