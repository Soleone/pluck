import { ThemePicker } from "@/components/soleone/theme-picker";
import { Kbd } from "@/components/ui/kbd";

export function App() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between p-4">
        <span className="font-heading font-medium">pluck</span>
        <ThemePicker />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <p className="text-muted-foreground">
          Press <Kbd>T</Kbd> for themes, <Kbd>D</Kbd> to flip dark and light.
        </p>
      </main>
    </div>
  );
}
