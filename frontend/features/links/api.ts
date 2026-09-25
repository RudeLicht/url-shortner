import { ApiError, apiFetch } from "@/lib/api/client";
import { urlEndpoints } from "@/lib/api/endpoints";
import type {
  LinkRedirectInfo,
  LinkStats,
  ShortenUrlRequest,
  ShortenUrlResponse,
} from "@/features/links/types";

export function shortenUrl(
  payload: ShortenUrlRequest
): Promise<ShortenUrlResponse> {
  return apiFetch<ShortenUrlResponse>(urlEndpoints.create(), {
    method: "POST",
    body: payload,
  });
}

/**
 * When `shortenUrl` rejects with a 409, the backend's body is
 * `{"message": "URL already shortened", "code": "<existing short code>"}`.
 * Extracts that existing code, or returns null when `err` isn't a
 * (well-formed) 409 conflict - e.g. a different status, a non-JSON body, or
 * an older backend that doesn't send `code` yet.
 */
export function getExistingCodeFromConflict(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409 || !err.isJson) {
    return null;
  }

  if (!err.data || typeof err.data !== "object") {
    return null;
  }

  const { code } = err.data as Record<string, unknown>;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Does NOT increment clicks - safe to call for dashboard listings. */
export function getLinkStats(code: string): Promise<LinkStats> {
  return apiFetch<LinkStats>(urlEndpoints.stats(code));
}

export function deleteLink(code: string): Promise<void> {
  return apiFetch<void>(urlEndpoints.delete(code), { method: "DELETE" });
}

/** INCREMENTS clicks - only use this for actually resolving a redirect. */
export function getLinkForRedirect(code: string): Promise<LinkRedirectInfo> {
  return apiFetch<LinkRedirectInfo>(urlEndpoints.resolve(code));
}
