import type { Action } from "@/bridge";

/** The first letter or digit of `name` no other action uses as its key, or "" when all are. */
export function suggestKey(name: string, others: Action[]): string {
  const taken = new Set(others.map((action) => action.key?.toLowerCase()));
  return (
    name
      .toLowerCase()
      .match(/[a-z0-9]/g)
      ?.find((char) => !taken.has(char)) ?? ""
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
