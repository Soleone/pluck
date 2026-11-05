const MODIFIERS = [
  ["Ctrl", "ctrlKey"],
  ["Alt", "altKey"],
  ["Shift", "shiftKey"],
  ["Super", "metaKey"],
] as const;

/**
 * The hotkey a key press makes, such as `Ctrl+Alt+Space`, by physical key so the keyboard layout
 * doesn't matter: Ctrl, Alt or Super plus a letter, digit, F-key or Space. Anything else is null.
 */
export function hotkeyFromKeyDown(event: KeyboardEvent): string | null {
  const key =
    /^Key([A-Z])$/.exec(event.code)?.[1] ??
    /^Digit(\d)$/.exec(event.code)?.[1] ??
    (/^F\d{1,2}$/.test(event.code) || event.code === "Space" ? event.code : null);
  if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return null;
  return [...MODIFIERS.filter(([, flag]) => event[flag]).map(([name]) => name), key].join("+");
}

const KEY_NAMES: Record<string, Record<string, string>> = {
  windows: { Super: "Win" },
  macos: { Super: "Cmd", Alt: "Option" },
  linux: {},
};

/** The hotkey's keys as the platform names them. */
export function hotkeyKeys(hotkey: string, platform: string): string[] {
  return hotkey.split("+").map((key) => KEY_NAMES[platform]?.[key] ?? key);
}
