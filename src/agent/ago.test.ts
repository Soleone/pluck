import { expect, test } from "vite-plus/test";
import { ago } from "./ago";

test("agent.last-active: minutes count up to an hour, then hours and days", () => {
  const now = Date.UTC(2026, 10, 5, 12);
  const minutes = (count: number) => now - count * 60_000;
  expect(ago(minutes(0.5), now)).toBe("just now");
  expect(ago(minutes(4), now)).toBe("4 min ago");
  expect(ago(minutes(59), now)).toBe("59 min ago");
  expect(ago(minutes(150), now)).toBe("2 h ago");
  expect(ago(minutes(60 * 30), now)).toBe("yesterday");
  expect(ago(minutes(60 * 24 * 3), now)).toBe("3 days ago");
});
