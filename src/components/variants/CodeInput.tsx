import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

/** An input for code, like a shell command: monospaced and not spell-checked. */
export function CodeInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input spellCheck={false} className={cn("font-mono", className)} {...props} />;
}
