import { expect, test } from "vite-plus/test";
import type { Action } from "@/bridge";
import { newId, suggestKey } from "@/menuActions";

const action = (id: string, key: string | null): Action => ({
  id,
  name: id,
  key,
  run: "",
  agent: "Explain this.",
  output: "notify",
  interactive: true,
  model: null,
  thinking: null,
});

test("menu-tab.key: a new action's key is the first free letter of its name", () => {
  const others = [action("explain", "e"), action("translate", "T")];
  expect(suggestKey("Context", others)).toBe("c");
  expect(suggestKey("Explore", others)).toBe("x");
  expect(suggestKey("Tee", others)).toBe("");
});

test("menu-tab.edit: a new action's id comes from its name and never repeats", () => {
  const actions = [action("deep-dive", null), action("deep-dive-2", null)];
  expect(newId("Deep dive!", actions)).toBe("deep-dive-3");
  expect(newId("Visualize", actions)).toBe("visualize");
  expect(newId("?!", actions)).toBe("action");
});
