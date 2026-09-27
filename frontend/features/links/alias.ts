// Mirrors the backend's alias validation (backend/app/features/schemas/url.py):
// `ALIAS_PATTERN` and the subset of `RESERVED_ALIASES` that can actually pass
// that pattern (the rest contain "." and are excluded by it already).
export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

// Compared case-insensitively, matching the backend.
const RESERVED_ALIASES = new Set(["api", "_next", "_not-found"]);

/** True when `alias` would be accepted by the backend's alias validation. */
export function isValidAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(alias) && !RESERVED_ALIASES.has(alias.toLowerCase());
}
