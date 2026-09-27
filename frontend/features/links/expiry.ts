export type ExpiryPreset = "never" | "1h" | "1d" | "7d" | "30d" | "custom";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const EXPIRY_PRESETS: { value: ExpiryPreset; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

const PRESET_DURATIONS: Record<Exclude<ExpiryPreset, "never" | "custom">, number> = {
  "1h": HOUR,
  "1d": DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
};

/**
 * Combines a calendar day with an "HH:mm" time into a single local Date.
 * Returns null when either part is missing or malformed.
 */
export function combineDateAndTime(
  date: Date | undefined,
  time: string | undefined
): Date | null {
  if (!date || !time) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const combined = new Date(date);
  combined.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return combined;
}

/**
 * Resolves the chosen preset to an absolute expiry, relative to `now`.
 * Returns null for "never", and for "custom" when no valid date/time is set.
 */
export function resolveExpiry(
  preset: ExpiryPreset,
  custom: Date | null,
  now: number
): Date | null {
  if (preset === "never") return null;
  if (preset === "custom") return custom;
  return new Date(now + PRESET_DURATIONS[preset]);
}

// Ends in "Z" or a "+hh:mm" / "-hh:mm" offset.
const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The expiry as epoch ms, or null for "never" / an unparseable value.
 *
 * A timestamp without a timezone (SQLite drops it, e.g. in the e2e backend)
 * is read as UTC, matching the backend's own `is_expired` - `new Date()`
 * would otherwise treat it as local time.
 */
export function expiryTime(expiry: string | null): number | null {
  if (!expiry) return null;
  const time = new Date(HAS_TIMEZONE.test(expiry) ? expiry : `${expiry}Z`).getTime();
  return Number.isNaN(time) ? null : time;
}

export function isExpired(expiry: string | null, now: number): boolean {
  const time = expiryTime(expiry);
  return time !== null && time <= now;
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", DAY],
  ["hour", HOUR],
  ["minute", 60 * 1000],
];

/** e.g. "in 3 days", "in 5 hours", "2 minutes ago". */
export function formatRelative(target: number, now: number): string {
  const diff = target - now;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= size) {
      return formatter.format(Math.round(diff / size), unit);
    }
  }
  return diff >= 0 ? "in less than a minute" : "just now";
}
