import { describe, expect, it } from "vitest";

import { todayInTimezone } from "../src/notifications/notifications.service";

describe("todayInTimezone", () => {
  const instant = new Date("2026-06-15T23:30:00.000Z");

  it("is date arithmetic in the archive's zone, not UTC", () => {
    // East of UTC it is already tomorrow; west of UTC still today.
    expect(todayInTimezone("Pacific/Kiritimati", instant)).toBe("2026-06-16");
    expect(todayInTimezone("Europe/Berlin", instant)).toBe("2026-06-16");
    expect(todayInTimezone("America/New_York", instant)).toBe("2026-06-15");
    expect(todayInTimezone("UTC", instant)).toBe("2026-06-15");
  });

  it("falls back to the system zone when unset", () => {
    expect(todayInTimezone(undefined, instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
