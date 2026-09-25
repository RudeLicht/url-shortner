const STORAGE_KEY = "url-shortener:tracked-codes";

function readRawCodes(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeCodes(codes: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
}

/** Returns the deduped list of short codes this browser has created. */
export function getTrackedCodes(): string[] {
  return Array.from(new Set(readRawCodes()));
}

export function addTrackedCode(code: string): void {
  const codes = getTrackedCodes();
  if (codes.includes(code)) {
    return;
  }
  writeCodes([code, ...codes]);
}

export function removeTrackedCode(code: string): void {
  const codes = getTrackedCodes().filter((existing) => existing !== code);
  writeCodes(codes);
}

/** Builds the full short link (e.g. `https://host/abc123`) for a code. */
export function buildShortUrl(code: string): string {
  if (typeof window === "undefined") return code;
  return `${window.location.origin}/${code}`;
}
