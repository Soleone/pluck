import type { LucideIcon } from "lucide-react";

/** One choice out of a few, as a row of tiles that each show an icon and a short label. */
export function ChoiceTiles({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon: LucideIcon; hint?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {options.map(({ value: option, label: name, icon: Icon, hint }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChange(option)}
          className="group flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-muted aria-checked:border-primary aria-checked:bg-primary/10"
        >
          <span className="flex max-w-full items-center gap-1.5 font-medium">
            <Icon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-colors group-aria-checked:text-primary"
            />
            <span className="truncate">{name}</span>
          </span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </button>
      ))}
    </div>
  );
}
