import { isTauri } from "@tauri-apps/api/core";
import { Popup } from "@/Popup";
import { ThemePicker } from "@/components/soleone/theme-picker";

export function App() {
  if (isTauri()) {
    return (
      <div className="h-svh bg-popover text-popover-foreground">
        <Popup />
      </div>
    );
  }

  // `pnpm dev:web`: the menu window at its native size, with sample data.
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between p-4">
        <span className="font-heading font-medium">pluck prototype</span>
        <ThemePicker />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="h-90 w-105 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
          <Popup />
        </div>
      </main>
    </div>
  );
}
