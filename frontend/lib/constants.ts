/**
 * Top-level route segments the app itself uses. A short code can never be
 * one of these, since it would otherwise be indistinguishable from (or get
 * shadowed by) a real page at the root `/[code]` route.
 */
export const RESERVED_CODES = [
  "login",
  "register",
  "dashboard",
  "links",
  "analytics",
  "security",
] as const;

export function isReservedCode(code: string): boolean {
  return (RESERVED_CODES as readonly string[]).includes(code);
}
