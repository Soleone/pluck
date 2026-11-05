import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Agents } from "@/Agents";
import { Home } from "@/Home";
import { Popup } from "@/Popup";
import { ThemePicker } from "@/components/soleone/theme-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function App() {
  if (isTauri()) {
    const label = getCurrentWindow().label;
    if (label === "agents")
      return (
        <div className="h-svh bg-background text-foreground">
          <Agents />
        </div>
      );
    return label === "home" ? (
      <div className="h-svh bg-background text-foreground">
        <Home />
      </div>
    ) : (
      <div className="h-svh bg-popover text-popover-foreground">
        <Popup />
      </div>
    );
  }
  return <Prototype />;
}

/** `pnpm dev:web`: each window at its native size, with sample data. */
function Prototype() {
  const [view, setView] = useState("menu");
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between p-4">
        <span className="font-heading font-medium">pluck prototype</span>
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="menu">Menu</TabsTrigger>
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
          </TabsList>
        </Tabs>
        <ThemePicker />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        {view === "agents" ? (
          <div className="h-180 w-full overflow-hidden rounded-xl border bg-background shadow-lg">
            <Agents />
          </div>
        ) : view === "menu" ? (
          <div className="h-90 w-105 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
            <Popup />
          </div>
        ) : (
          <div className="h-180 w-200 overflow-hidden rounded-xl border bg-background shadow-lg">
            <Home />
          </div>
        )}
      </main>
    </div>
  );
}
