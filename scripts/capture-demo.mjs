#!/usr/bin/env node
// Records the browser demo as the README's looping WebP: an agent's one-off reply streams into a
// panel, then a question about the selected text opens an agent session.
// Usage: node scripts/capture-demo.mjs [--url http://localhost:4173] [--out docs/media/demo.webp]
// Needs agent-browser (with its browser installed) and FFmpeg on the PATH. Serve the build first,
// for example `pnpm build && pnpm preview`.
import { parseArgs } from "node:util";
import { record } from "@soleone/showcase-capture";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://pluck.soleone.xyz" },
    out: { type: "string", default: "docs/media/demo.webp" },
  },
});

const question = "Who said this, and what did he mean?";
const menuIsOpen = `!!document.querySelector("input[placeholder^='Filter actions']")`;

await record({
  url: values.url,
  out: values.out,
  // Recorded at output width so the menu isn't small. The crop drops the empty band at the bottom.
  viewport: { width: 960, height: 640 },
  crop: "iw:ih*0.78:0:ih*0.12",
  async start(page) {
    await page.waitFor(`!!document.querySelector("input")`, { timeoutMs: 30_000 });
  },
  async drive(page) {
    const startAt = await page.now();
    await page.sleep(1200);
    await page.run("press", "d");
    await page.sleep(2600);
    await page.run("press", "Escape");
    await page.waitFor(menuIsOpen);
    await page.sleep(1000);
    await page.run("press", "Space");
    for (const word of question.split(" ")) await page.run("keyboard", "type", `${word} `);
    await page.sleep(600);
    await page.run("press", "Enter");
    await page.waitFor(`document.body.innerText.includes("limits of my world")`);
    await page.sleep(3000);
    await page.click("Menu", "tab");
    await page.waitFor(menuIsOpen);
    await page.sleep(800);
    return { startAt, endAt: await page.now() };
  },
  async verify(page) {
    if (!(await page.eval(menuIsOpen))) return "the clip did not end on the menu";
  },
  attempts: 3,
});
