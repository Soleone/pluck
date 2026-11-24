import { expect, test } from "vite-plus/test";
import type { Action } from "@/bridge";
import {
  entriesAt,
  menuTree,
  moveEntry,
  moveEntryTo,
  newId,
  renameFolder,
  suggestKey,
  ungroup,
  type Entry,
} from "@/menuActions";

const action = (id: string, key: string | null, folder: string | null = null): Action => ({
  id,
  name: id,
  key,
  folder,
  run: "",
  agent: "Explain this.",
  output: "notify",
  model: null,
  thinking: null,
});

/** Each entry as its id, or a folder as `name(key)[...]`. */
const shape = (entries: Entry[]): string[] =>
  entries.map((entry) =>
    entry.kind === "action"
      ? `${entry.action.id}${entry.action.key ? `:${entry.action.key}` : ""}`
      : `${entry.name}(${entry.key})[${shape(entry.entries).join(" ")}]`,
  );
const layout = (actions: Action[]) => shape(menuTree(actions)).join(" ");

const sample = [
  action("explain", "e"),
  action("english", "e", "Translate"),
  action("search", "s"),
  action("german", "g", "Translate"),
  action("bookmark", "b", "Save"),
  action("later", "l", "Save/Read later"),
];

test("actions-tab.key: a new action's key is the first free letter of its name", () => {
  expect(suggestKey("Context", ["e", "T"])).toBe("c");
  expect(suggestKey("Explore", ["e", "t"])).toBe("x");
  expect(suggestKey("Tee", ["e", "t"])).toBe("");
});

test("actions-tab.edit: a new action's id comes from its name and never repeats", () => {
  const actions = [action("deep-dive", null), action("deep-dive-2", null)];
  expect(newId("Deep dive!", actions)).toBe("deep-dive-3");
  expect(newId("Visualize", actions)).toBe("visualize");
  expect(newId("?!", actions)).toBe("action");
});

test("menu.folder: a folder sits where its first action is listed and holds its actions in order", () => {
  expect(layout(sample)).toBe(
    "explain:e Translate(t)[english:e german:g] search:s Save(a)[bookmark:b Read later(r)[later:l]]",
  );
  expect(shape(entriesAt(menuTree(sample), ["Save", "Read later"]))).toEqual(["later:l"]);
});

test("menu.folder-keys: a folder takes the first letter of its name its level's actions leave free", () => {
  expect(layout([action("save", "s"), action("bookmark", "b", "Save")])).toBe(
    "save:s Save(a)[bookmark:b]",
  );
});

test("actions-tab.move: entries move among their folder, and into, out of and between folders", () => {
  expect(layout(moveEntry(sample, "folder:Translate", 1))).toMatch(/^explain:e search:s Translate/);
  expect(layout(moveEntry(sample, "german", -1))).toMatch(/Translate\(t\)\[german:g english:e\]/);
  expect(layout(moveEntryTo(sample, "explain", { beside: "search", after: true }))).toMatch(
    /^Translate\(t\)\[english:e german:g\] search:s explain:e/,
  );
  expect(layout(moveEntryTo(sample, "search", { into: ["Save"] }))).toMatch(
    /Save\(s\)\[bookmark:b Read later\(r\)\[later:l\] search:s\]$/,
  );
  expect(layout(moveEntryTo(sample, "later", { beside: "explain", after: false }))).toMatch(
    /^later:l explain:e .* Save\(a\)\[bookmark:b\]$/,
  );
});

test("actions-tab.move: a new folder appears where the moved action was", () => {
  expect(layout(moveEntryTo(sample, "search", { into: ["Web"] }))).toMatch(
    /Translate\(t\)\[english:e german:g\] Web\(w\)\[search:s\] Save/,
  );
});

test("actions-tab.move: a key the target folder already uses gives way to a free letter", () => {
  expect(layout(moveEntryTo(sample, "explain", { into: ["Translate"] }))).toMatch(
    /Translate\(t\)\[english:e german:g explain:x\]/,
  );
});

test("actions-tab.move: a folder never moves into itself", () => {
  expect(moveEntryTo(sample, "folder:Save", { into: ["Save", "Read later"] })).toBe(sample);
  expect(moveEntryTo(sample, "folder:Save", { beside: "later", after: true })).toBe(sample);
});

test("actions-tab.ungroup: a deleted folder's actions take its place", () => {
  expect(layout(ungroup(sample, ["Translate"]))).toMatch(/^explain:e english:n german:g search:s/);
});

test("actions-tab.rename-folder: renaming moves every action under it, nested ones too", () => {
  expect(layout(renameFolder(sample, ["Save"], "Keep"))).toMatch(
    /Keep\(k\)\[bookmark:b Read later\(r\)\[later:l\]\]$/,
  );
});
