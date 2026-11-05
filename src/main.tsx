import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider } from "@/components/soleone/theme";
import { THEME_STORAGE_KEY } from "@/theme/config";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
