import { describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  expiryTime,
  formatRelative,
  isExpired,
  resolveExpiry,
} from "@/features/links/expiry";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("expiryTime", () => {
  it("returns null for no expiry or an unparseable one", () => {
    expect(expiryTime(null)).toBeNull();
    expect(expiryTime("not a date")).toBeNull();
  });

  it("respects an explicit timezone", () => {
    expect(expiryTime("2026-01-01T12:00:00+00:00")).toBe(Date.UTC(2026, 0, 1, 12));
    expect(expiryTime("2026-01-01T12:00:00Z")).toBe(Date.UTC(2026, 0, 1, 12));
    expect(expiryTime("2026-01-01T14:00:00+02:00")).toBe(Date.UTC(2026, 0, 1, 12));
  });

  it("reads a timestamp without a timezone as UTC, like the backend does", () => {
    expect(expiryTime("2026-01-01T12:00:00")).toBe(Date.UTC(2026, 0, 1, 12));
    expect(expiryTime("2026-01-01T12:00:00.123456")).toBe(
      Date.UTC(2026, 0, 1, 12, 0, 0, 123)
    );
  });
});

describe("isExpired", () => {
  const expiry = "2026-01-01T12:00:00Z";
  const at = Date.UTC(2026, 0, 1, 12);

  it("is expired from the expiry moment onwards", () => {
    expect(isExpired(expiry, at - 1)).toBe(false);
    expect(isExpired(expiry, at)).toBe(true);
  });

  it("never expires without an expiry", () => {
    expect(isExpired(null, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("resolveExpiry", () => {
  const now = Date.UTC(2026, 0, 1);

  it("resolves presets relative to now", () => {
    expect(resolveExpiry("never", null, now)).toBeNull();
    expect(resolveExpiry("1h", null, now)?.getTime()).toBe(now + HOUR);
    expect(resolveExpiry("1d", null, now)?.getTime()).toBe(now + DAY);
    expect(resolveExpiry("7d", null, now)?.getTime()).toBe(now + 7 * DAY);
    expect(resolveExpiry("30d", null, now)?.getTime()).toBe(now + 30 * DAY);
  });

  it("uses the custom date as-is", () => {
    const custom = new Date(2026, 5, 15, 9, 30);
    expect(resolveExpiry("custom", custom, now)).toBe(custom);
    expect(resolveExpiry("custom", null, now)).toBeNull();
  });
});

describe("combineDateAndTime", () => {
  it("sets the local time on the picked day", () => {
    const combined = combineDateAndTime(new Date(2026, 5, 15), "09:30");
    expect(combined).toEqual(new Date(2026, 5, 15, 9, 30));
  });

  it("returns null when a part is missing or malformed", () => {
    expect(combineDateAndTime(undefined, "09:30")).toBeNull();
    expect(combineDateAndTime(new Date(), "")).toBeNull();
    expect(combineDateAndTime(new Date(), "9am")).toBeNull();
  });
});

describe("formatRelative", () => {
  const now = Date.UTC(2026, 0, 1);

  it("picks the largest whole unit", () => {
    expect(formatRelative(now + 3 * DAY, now)).toBe("in 3 days");
    expect(formatRelative(now + 5 * HOUR, now)).toBe("in 5 hours");
    expect(formatRelative(now + 10 * 60 * 1000, now)).toBe("in 10 minutes");
    expect(formatRelative(now + 10 * 1000, now)).toBe("in less than a minute");
  });
});
