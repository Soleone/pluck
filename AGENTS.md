# pluck

Pluck is a desktop app (Tauri) that sends text selected in any app to the user's own scripts through a small hotkey menu. Windows first, then macOS and Linux (Omarchy/Hyprland).

## Running it

- `pnpm dev:web` runs the UI in a browser with sample data. Use it for UI work.
- `pnpm dev` runs the native app. It builds for the OS it runs on, so for Windows: run `win-sync` here (copies to `D:\src\wsl\pluck`, profile in `~/.config/win-sync/pluck.ignore`), then `pnpm install` and `pnpm dev` there in PowerShell.
- `pnpm build:tauri` builds the app and installers. On Windows it builds only the NSIS setup exe (`src-tauri\target\release\bundle\nsis`); the plain exe is `src-tauri\target\release\pluck.exe`.
- WSL lacks the system libraries for a Linux build, so nothing native links here, and Rust tests run on Windows (`cargo test` in `src-tauri`) and in the release workflow. Every platform still type-checks from WSL, since checking links nothing; stub tools that only touch their output file are enough:
  - Windows: `cargo clippy --tests --target x86_64-pc-windows-gnu` with `x86_64-w64-mingw32-windres`, `-gcc` and `-ar` stubs on PATH.
  - macOS: `cargo clippy --tests --target aarch64-apple-darwin` with `CC_aarch64_apple_darwin` and `AR_aarch64_apple_darwin` pointing at stubs.
  - Linux: `cargo clippy --tests` with `PKG_CONFIG` pointing at a stub that answers `--modversion` with any version and succeeds otherwise.
- The icon is `public/favicon.svg`. After changing it, run `pnpm tauri icon public/favicon.svg` and delete the generated `android/` and `ios/` folders.

## Releasing

`pnpm release` bumps the version, writes CHANGELOG.md and pushes a `v*` tag. `.github/workflows/release.yml` then builds the signed Windows installer and publishes it with `latest.json`, which the in-app updater reads from `github.com/Soleone/pluck`. The signing key is in `$DATA/secrets/pluck` and in the repo's Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Local `pnpm build:tauri` builds an unsigned installer, which is fine for testing.

## Demo and portfolio

The browser build (`pnpm dev:web`) doubles as the public demo at https://pluck.soleone.xyz, the Vercel project `pluck-demo`, which is not connected to git. Redeploy after UI changes: `pnpm build && cd dist && vercel link --yes --project pluck-demo && vercel deploy --prod --yes` (the build wipes `dist/.vercel`). `showcase.json` holds what the portfolio shows; re-record the README loop with `pnpm media:capture --url <preview url>` once what it shows changes.

## Where things are

- [spec/](spec/README.md) says what the app does, as rule tables. Read it before changing behavior.
- docs/ holds anything else worth keeping: decisions, evidence, research. Create it when needed.
- `.kit.json` records which kit template and revision this project was made from. Run `kit upgrade` to see what changed in the kit since.

## Spec

Behavior is written as rules in tables with a stable slug, `area.behavior`. Tests start their title with the slug (`test("capture.open: ...")`), so `rg capture.open` finds the rule, the test and usually the code. When behavior changes, change its rule and the test that cites it together. The spec describes the target app; it doesn't authorize building all of it at once. Evidence, status and counts never go in the spec.

## Principles

- **Build the smallest real slice.** Straightforward modules and concrete code first. Add abstractions, caches or performance machinery when real use and measurement justify them.
- **Make clean cuts.** One current model, not versioned code paths. Never add version-named files, identifiers, flags or env vars (`v2`, `new`, `legacy`); name things by responsibility.
- **Keep the UI calm.** Minimal and sleek is the baseline, not a later polish step. Show the main thing, disclose details on demand.

## UI

- shadcn on Base UI (`base-nova`). App code uses the components in `src/components/ui`; direct `@base-ui/react` imports are lint errors.
- Enabled native buttons and `[role="button"]` controls use the pointer cursor, set in global CSS rather than by editing vendored components.
- `src/components/ui` and `src/components/soleone` are vendored and stay byte-for-byte upstream so they can be updated with `pnpm dlx shadcn add <item> --overwrite`. Don't edit them. `kit check` fails when they drift.
- Style through tokens and component props, never raw colors, arbitrary values or className overrides on primitives. The lint rules in `vite.config.ts` enforce this.
- Need a look the stock variants don't have? Wrap the primitive in `src/components/variants/` (e.g. `ToolbarButton` around `Button`) and use the wrapper. A plain class map plus `cn()` covers one state or one small set of kinds; reach for `cva` when a wrapper has several variant axes or compound variants, or exports its classes for use without the component. That folder is the only place allowed to restyle primitives or import `class-variance-authority`.
- Themes come from `@soleone/theme`. `src/theme/config.ts` holds this app's default theme and storage key. Components use tokens only, so every theme works without knowing about them.
- Shared components belong in the registry (Soleone/shadcn-components), not copied between apps.

## Before you finish

Run `vp check` and `kit check` and fix every error. `kit check` includes knip: an unused file, export or dependency is a finding. Delete it rather than ignore it.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
