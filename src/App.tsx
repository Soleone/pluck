import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Agents } from "@/Agents";
import { Home } from "@/Home";
import { Popup } from "@/Popup";
import { SHOW_AGENTS_EVENT } from "@/bridge";
import { Button } from "@/components/ui/button";
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

const RELEASES_URL = "https://github.com/Soleone/pluck/releases/latest";

/** `pnpm dev:web` and the hosted demo: each window at its native size, with sample data. */
function Prototype() {
  const [view, setView] = useState("menu");
  useEffect(() => {
    const showAgents = () => setView("agents");
    window.addEventListener(SHOW_AGENTS_EVENT, showAgents);
    return () => window.removeEventListener(SHOW_AGENTS_EVENT, showAgents);
  }, []);
  return (
    <div className="flex min-h-svh flex-col">
      <header className="grid grid-cols-3 items-center p-4">
        <div className="flex flex-col">
          <span className="font-heading font-medium">pluck</span>
          <span className="text-xs text-muted-foreground">
            Browser demo: sample text, canned replies
          </span>
        </div>
        <Tabs value={view} onValueChange={setView} className="justify-self-center">
          <TabsList>
            <TabsTrigger value="menu">Menu</TabsTrigger>
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 justify-self-end">
          <ThemePicker />
        </div>
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
      <div className="fixed right-4 bottom-4 z-40 md:right-8 md:bottom-8">
        <Button
          size="lg"
          nativeButton={false}
          render={<a href={RELEASES_URL} target="_blank" rel="noreferrer" />}
        >
          <Download aria-hidden="true" />
          Download the app
        </Button>
      </div>
    </div>
  );
}
