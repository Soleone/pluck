import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
import { BUILTIN_THEMES } from "./src/components/soleone/theme/palettes";
import { themePlugin } from "./src/components/soleone/theme-vite";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./src/theme/config";

// Vendored code: shadcn primitives and @soleone registry items. They stay byte-for-byte upstream so
// `shadcn add --overwrite` can update them; `kit check` verifies that.
const vendored = ["src/components/ui/**", "src/components/soleone/**"];

const noBaseUi = {
  group: ["@base-ui/react", "@base-ui/react/*"],
  message:
    "Use a local high-level component from @/components/ui instead of importing Base UI primitives directly.",
};
const noCva = {
  group: ["class-variance-authority"],
  message:
    "Variants live in src/components/variants: wrap the primitive there and import the wrapper.",
};

export default defineConfig({
  plugins: lazyPlugins(() => [
    react(),
    tailwindcss(),
    themePlugin({
      themes: BUILTIN_THEMES,
      defaultTheme: DEFAULT_THEME,
      storageKey: THEME_STORAGE_KEY,
    }),
  ]),
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  staged: { "*": "vp check --fix" },
  fmt: { ignorePatterns: vendored },
  lint: {
    plugins: ["react", "typescript", "oxc", "unicorn"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }, "@shadcn/lint"],
    ignorePatterns: ["dist/**", ...vendored],
    options: { typeAware: true, typeCheck: true },
    settings: {
      shadcn: {
        ui: "@/components/ui",
        note: "Follow the design tokens and component variants defined in src/index.css and src/components/ui.",
      },
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "no-restricted-imports": ["error", { patterns: [noBaseUi, noCva] }],
    },
    overrides: [
      {
        // Wrappers around stock primitives: the one place that restyles them and adds variants.
        files: ["src/components/variants/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "no-restricted-imports": ["error", { patterns: [noBaseUi] }],
        },
      },
    ],
  },
});
