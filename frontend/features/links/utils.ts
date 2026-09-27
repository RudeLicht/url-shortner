import type { TrackedEntry } from "@/features/links/types";

/**
 * Current storage key for the `{ code, token }[]` format. Deliberately
 * different from `LEGACY_STORAGE_KEY`: writing the new object format under
 * the old key would make a previous build of this frontend (still open in a
 * stale tab during a deploy, or after a rollback) parse it, keep only the
 * entries it recognizes as plain strings, and drop every one that carries a
 * token - then persist that filtered list back on its next add/remove,
 * permanently destroying delete tokens. Keeping the formats on separate keys
 * means an old build simply keeps using its own list under the legacy key,
 * untouched by anything written here.
 */
export const STORAGE_KEY = "url-shortener:tracked-links";
/** Legacy key, from before delete tokens existed: a plain array of code strings. Read (once, to migrate) but never written to. */
export const LEGACY_STORAGE_KEY = "url-shortener:tracked-codes";

/**
 * Parses a single raw stored item into a `TrackedEntry`, or `null` if it's
 * malformed and should be dropped entirely.
 *
 * - The legacy format (a plain string code, from before delete tokens
 *   existed) becomes `{ code, token: null }`.
 * - The current format is `{ code, token }`; a `code` that isn't a
 *   non-empty string makes the whole item invalid (dropped). A `token`
 *   that isn't a string or `null` is treated as `null` rather than
 *   dropping the item, since the code itself is still valid and worth
 *   keeping (just as read-only).
 */
function parseEntry(item: unknown): TrackedEntry | null {
  if (typeof item === "string") {
    return item.length > 0 ? { code: item, token: null } : null;
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const { code, token } = item as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0) {
    return null;
  }

  return {
    code,
    token: typeof token === "string" && token.length > 0 ? token : null,
  };
}

/** Parses a raw JSON string (the contents of either storage key) into entries, treating anything malformed as empty. */
function parseStoredEntries(raw: string): TrackedEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map(parseEntry)
    .filter((entry): entry is TrackedEntry => entry !== null);
}

function readRawEntries(): TrackedEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    return parseStoredEntries(raw);
  }

  // The new key hasn't been written yet on this browser - migrate once from
  // the legacy plain-string format, if any. The legacy key itself is left
  // untouched (see STORAGE_KEY's comment); only the new key gets the
  // migrated result, so this only happens once (the next call finds
  // STORAGE_KEY already set, even to an empty array).
  const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyRaw === null) {
    return [];
  }

  const migrated = dedupeEntries(parseStoredEntries(legacyRaw));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

/** Dedupes by code, preferring an entry that has a token over one that doesn't. */
function dedupeEntries(entries: TrackedEntry[]): TrackedEntry[] {
  const byCode = new Map<string, TrackedEntry>();
  for (const entry of entries) {
    const existing = byCode.get(entry.code);
    if (!existing || (existing.token === null && entry.token !== null)) {
      byCode.set(entry.code, entry);
    }
  }
  return Array.from(byCode.values());
}

function writeEntries(entries: TrackedEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** Returns the deduped list of links (code + delete token, if owned) this browser knows about. */
export function getTrackedEntries(): TrackedEntry[] {
  return dedupeEntries(readRawEntries());
}

/**
 * Tracks a code, most-recently-created first, and returns the entry that
 * was stored for that code *before* this call (or `undefined` if the code
 * wasn't tracked yet) - callers use this to tell "already in your list"
 * apart from "brand new to this browser" without a separate read.
 *
 * A non-null token always replaces whatever was stored (codes get reused -
 * e.g. SQLite rowid reuse after the highest id is deleted, or an expired
 * row's replacement - so a fresh token is never stale). A null token never
 * downgrades an existing token, so re-tracking a link this browser already
 * owns (e.g. from a 409 conflict) can't lose it. An empty-string token is
 * treated as absent, same as on read.
 */
export function addTrackedEntry(
  code: string,
  token: string | null
): TrackedEntry | undefined {
  const normalizedToken = token && token.length > 0 ? token : null;
  const entries = getTrackedEntries();
  const existing = entries.find((entry) => entry.code === code);

  if (!existing) {
    writeEntries([{ code, token: normalizedToken }, ...entries]);
    return undefined;
  }

  if (normalizedToken !== null) {
    writeEntries(
      entries.map((entry) =>
        entry.code === code ? { code, token: normalizedToken } : entry
      )
    );
  }

  return existing;
}

/**
 * Downgrades a tracked entry to read-only (e.g. after the backend rejects
 * its delete token as invalid), keeping the code in the list but dropping
 * its token so it renders "Remove from list" instead of "Delete". Unlike
 * `addTrackedEntry`, this deliberately can downgrade a token. A no-op if
 * the code isn't tracked.
 */
export function markTrackedEntryReadOnly(code: string): void {
  const entries = getTrackedEntries();
  if (!entries.some((entry) => entry.code === code)) {
    return;
  }

  writeEntries(
    entries.map((entry) => (entry.code === code ? { code, token: null } : entry))
  );
}

export function removeTrackedEntry(code: string): void {
  const entries = getTrackedEntries().filter((entry) => entry.code !== code);
  writeEntries(entries);
}

/**
 * Removes a tracked entry, but only if the entry currently stored for that
 * code still has the same token as `entry` (comparing `null` as equal to
 * `null`). Meant for callers holding a stale snapshot from before an async
 * gap (e.g. an in-flight stats request that 404s) - since codes can be
 * reused (SQLite rowid reuse, or an expired row's replacement), a fresh
 * `addTrackedEntry` may have re-tracked the same code with a new token
 * during that gap, and unconditionally removing by code would delete that
 * newer entry and permanently lose its delete token. A no-op if the code
 * isn't tracked, or is tracked with a different token than `entry`.
 */
export function removeTrackedEntryIfUnchanged(entry: TrackedEntry): void {
  const entries = getTrackedEntries();
  const current = entries.find((e) => e.code === entry.code);
  if (!current || current.token !== entry.token) {
    return;
  }

  writeEntries(entries.filter((e) => e.code !== entry.code));
}

/** Builds the full short link (e.g. `https://host/abc123`) for a code. */
export function buildShortUrl(code: string): string {
  if (typeof window === "undefined") return code;
  return `${window.location.origin}/${code}`;
}
