import type { Plugin } from "vite"
// Relative on purpose: vite.config.ts loads this before Vite's `@` alias exists.
import { createThemeHead, type ThemeHeadConfig } from "../theme/head"

const MODULE_ID = "virtual:theme-options"
const RESOLVED_ID = `\0${MODULE_ID}`

/**
 * The Vite counterpart of a server layout's theme head: inlines every theme's tokens and the
 * pre-paint script into index.html, and hands the client plain `ThemeOption`s through
 * `virtual:theme-options`, so the palettes never ship to the browser.
 *
 * ```ts
 * // vite.config.ts
 * plugins: [themePlugin({ themes: BUILTIN_THEMES, defaultTheme: "gilt", storageKey: "app.theme" })]
 * // main.tsx
 * import { themeOptions } from "virtual:theme-options"
 * ```
 */
export function themePlugin(config: ThemeHeadConfig): Plugin {
  const { themeOptions, themeStyles, themeScript } = createThemeHead(config)
  const canvas = themeOptions.find((theme) => theme.name === config.defaultTheme)?.canvas

  return {
    name: "soleone-theme",
    resolveId: (id) => (id === MODULE_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? `export const themeOptions = ${JSON.stringify(themeOptions)}` : undefined),
    transformIndexHtml: () => [
      // Keeps Dark Reader from restyling the themes, which would also rewrite inline styles.
      { tag: "meta", attrs: { name: "darkreader-lock" }, injectTo: "head-prepend" },
      ...(canvas ? [{ tag: "meta", attrs: { name: "theme-color", content: canvas }, injectTo: "head-prepend" as const }] : []),
      { tag: "style", children: themeStyles, injectTo: "head" },
      { tag: "script", children: themeScript, injectTo: "head" },
    ],
  }
}
