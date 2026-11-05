// Stages the Windows installer for a GitHub release and writes latest.json, the manifest the
// in-app updater reads. Run by .github/workflows/release.yml after a signed build.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const [tag, output] = process.argv.slice(2);
if (tag !== `v${version}`) throw new Error(`Tag ${tag} doesn't match package.json ${version}.`);
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error("Set GITHUB_REPOSITORY to owner/repository.");

const source = path.join(
  root,
  `src-tauri/target/release/bundle/nsis/Pluck_${version}_x64-setup.exe`,
);
const name = `Pluck-${version}-Windows-x64-setup.exe`;
mkdirSync(output, { recursive: true });
copyFileSync(source, path.join(output, name));

const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const section = changelog
  .split(/(?=^#{1,2} \[?\d+\.\d+\.\d+)/m)
  .find((part) => /^#{1,2} \[?(\d+\.\d+\.\d+)/.exec(part)?.[1] === version);
if (!section) throw new Error(`No changelog entry for ${version}.`);
const notes = section.slice(section.indexOf("\n") + 1).trim();

const platforms = {
  "windows-x86_64": {
    signature: readFileSync(`${source}.sig`, "utf8").trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
  },
};
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(path.join(output, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(output, "notes.md"), `${notes}\n`);
