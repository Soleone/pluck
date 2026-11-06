import type { ComponentProps } from "react";
import { cn } from "cn";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";

/** A dropdown menu as wide as its items, for menus opened from an icon button. */
export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent className={cn("w-auto", className)} {...props} />;
}
