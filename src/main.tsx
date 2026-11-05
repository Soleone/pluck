import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider } from "@/components/soleone/theme";
import { THEME_STORAGE_KEY } from "@/theme/config";
import { App } from "./App";
import { bridge } from "./bridge";
import "./index.css";

// Links in replies and quotes open in the browser, not in pluck's window.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element && event.target.closest("a[href]");
  if (!link || !/^(https?|mailto):/.test((link as HTMLAnchorElement).href)) return;
  event.preventDefault();
  void bridge.openUrl((link as HTMLAnchorElement).href);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
