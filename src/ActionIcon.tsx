import { Bell, Copy, Replace, ScrollText, Sparkles } from "lucide-react";
import type { Action } from "@/bridge";

const OUTPUT_ICONS = {
  session: Sparkles,
  show: ScrollText,
  copy: Copy,
  notify: Bell,
  replace: Replace,
};

/** What picking the action does: a sparkle for prompts, else what happens with the output. */
export function ActionIcon({ action }: { action: Action }) {
  const Icon = action.agent ? Sparkles : OUTPUT_ICONS[action.output];
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}
