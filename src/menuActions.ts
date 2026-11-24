import type { Action } from "@/bridge";

/** The first letter or digit of `name` not in `taken`, or "" when all are. */
export function suggestKey(name: string, taken: Iterable<string | null>): string {
  const used = new Set([...taken].map((key) => key?.toLowerCase()));
  return (
    name
      .toLowerCase()
      .match(/[a-z0-9]/g)
      ?.find((char) => !used.has(char)) ?? ""
  );
}

/** A stable id for a new action, from its name and unique among `actions`. */
export function newId(name: string, actions: Action[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "action";
  const ids = new Set(actions.map((action) => action.id));
  let id = base;
  for (let count = 2; ids.has(id); count++) id = `${base}-${count}`;
  return id;
}

export type Folder = {
  kind: "folder";
  name: string;
  /** Its own name last. */
  path: string[];
  /** The first free letter of its name at its level, after the actions' keys; "" when none is. */
  key: string;
  entries: Entry[];
};
export type Entry = { kind: "action"; action: Action } | Folder;

export const folderPath = (action: Action): string[] => action.folder?.split("/") ?? [];

/** Every folder's path joined with `/`, in menu order, outer ones before the ones in them. */
export const folderPaths = (actions: Action[]): string[] => [
  ...new Set(
    actions.flatMap((action) =>
      folderPath(action).map((_, depth, path) => path.slice(0, depth + 1).join("/")),
    ),
  ),
];

/** The actions as the menu nests them, each folder where its first action is listed. */
export function menuTree(actions: Action[]): Entry[] {
  const top: Entry[] = [];
  const folders = new Map<string, Folder>();
  for (const action of actions) {
    let level = top;
    const path: string[] = [];
    for (const name of folderPath(action)) {
      path.push(name);
      const id = path.join("/");
      let folder = folders.get(id);
      if (!folder) {
        folder = { kind: "folder", name, path: [...path], key: "", entries: [] };
        folders.set(id, folder);
        level.push(folder);
      }
      level = folder.entries;
    }
    level.push({ kind: "action", action });
  }
  for (const folder of [{ entries: top }, ...folders.values()]) {
    const taken = folder.entries.flatMap((entry) =>
      entry.kind === "action" ? [entry.action.key] : [],
    );
    for (const entry of folder.entries) {
      if (entry.kind !== "folder") continue;
      entry.key = suggestKey(entry.name, taken);
      taken.push(entry.key);
    }
  }
  return top;
}

/** The entries inside the folder at `path`, or the top level's. */
export function entriesAt(tree: Entry[], path: string[]): Entry[] {
  let level = tree;
  for (const name of path) {
    const folder = level.find((entry) => entry.kind === "folder" && entry.name === name);
    if (folder?.kind !== "folder") return [];
    level = folder.entries;
  }
  return level;
}

export const countActions = (folder: Folder): number =>
  folder.entries.reduce(
    (count, entry) => count + (entry.kind === "action" ? 1 : countActions(entry)),
    0,
  );

/**
 * The tree back as the flat list pluck.toml holds, each action's folder set from where it sits.
 * A key already used earlier in the same folder gives way to a free letter, so moves never clash.
 */
function flattenTree(entries: Entry[], path: string[] = []): Action[] {
  const taken: (string | null)[] = [];
  return entries.flatMap((entry) => {
    if (entry.kind === "folder") return flattenTree(entry.entries, [...path, entry.name]);
    const { action } = entry;
    const clashes = action.key !== null && taken.includes(action.key.toLowerCase());
    const key = clashes ? suggestKey(action.name, taken) || null : action.key;
    taken.push(key?.toLowerCase() ?? null);
    return [{ ...action, key, folder: path.length ? path.join("/") : null }];
  });
}

/** An action's id, or `folder:` and a folder's path, so Home can name any row. */
export const entryId = (entry: Entry): string =>
  entry.kind === "action" ? entry.action.id : `folder:${entry.path.join("/")}`;

function locate(level: Entry[], id: string): { level: Entry[]; index: number } | null {
  const index = level.findIndex((entry) => entryId(entry) === id);
  if (index >= 0) return { level, index };
  for (const entry of level) {
    const found = entry.kind === "folder" && locate(entry.entries, id);
    if (found) return found;
  }
  return null;
}

/** Moves an entry one place up or down among the entries of its folder. */
export function moveEntry(actions: Action[], id: string, by: -1 | 1): Action[] {
  const tree = menuTree(actions);
  const found = locate(tree, id);
  if (!found || !found.level[found.index + by]) return actions;
  found.level.splice(found.index + by, 0, ...found.level.splice(found.index, 1));
  return flattenTree(tree);
}

/**
 * Moves an entry to the end of the folder at `into`, creating it where the entry was when it's
 * new, or next to the entry `beside`. A folder never moves into itself.
 */
export function moveEntryTo(
  actions: Action[],
  id: string,
  target: { into: string[] } | { beside: string; after: boolean },
): Action[] {
  const tree = menuTree(actions);
  const from = locate(tree, id);
  if (!from) return actions;
  const [entry] = from.level.splice(from.index, 1);
  if ("beside" in target) {
    // Not found once the entry is out when it's inside the moved folder.
    const to = locate(tree, target.beside);
    if (!to) return actions;
    to.level.splice(to.index + (target.after ? 1 : 0), 0, entry);
    return flattenTree(tree);
  }
  if (entry.kind === "folder" && `${target.into.join("/")}/`.startsWith(`${entry.path.join("/")}/`))
    return actions;
  let level = tree;
  for (const [depth, name] of target.into.entries()) {
    let folder = level.find((other) => other.kind === "folder" && other.name === name);
    if (folder?.kind !== "folder") {
      folder = {
        kind: "folder",
        name,
        path: target.into.slice(0, depth + 1),
        key: "",
        entries: [],
      };
      level.splice(level === from.level ? from.index : level.length, 0, folder);
    }
    level = folder.entries;
  }
  level.push(entry);
  return flattenTree(tree);
}

function locateFolder(tree: Entry[], path: string[]) {
  const found = locate(tree, `folder:${path.join("/")}`);
  const folder = found?.level[found.index];
  return found && folder?.kind === "folder" ? { ...found, folder } : null;
}

/** Puts a folder's entries where the folder was, so deleting it loses no action. */
export function ungroup(actions: Action[], path: string[]): Action[] {
  const tree = menuTree(actions);
  const found = locateFolder(tree, path);
  if (!found) return actions;
  found.level.splice(found.index, 1, ...found.folder.entries);
  return flattenTree(tree);
}

/** Renames a folder; a name its sibling already has merges the two. */
export function renameFolder(actions: Action[], path: string[], name: string): Action[] {
  const tree = menuTree(actions);
  const found = locateFolder(tree, path);
  if (!found) return actions;
  found.folder.name = name;
  return flattenTree(tree);
}
