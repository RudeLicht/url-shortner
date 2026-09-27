import { ApiError, apiFetch } from "@/lib/api/client";
import { urlEndpoints } from "@/lib/api/endpoints";
import type {
  LinkRedirectInfo,
  LinkStats,
  ShortenUrlRequest,
  ShortenUrlResponse,
  UpdateLinkRequest,
  UpdateLinkResponse,
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

/**
 * True when `err` is the backend's "alias already taken" 409 -
 * `{"message": "Alias already taken", "error": "alias_taken"}`, with no
 * `code` field (so `getExistingCodeFromConflict` correctly returns null for
 * it, keeping this a separate branch from the duplicate-URL conflict).
 */
export function isAliasTakenConflict(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409 || !err.isJson) {
    return false;
  }

  if (!err.data || typeof err.data !== "object") {
    return false;
  }

  const { error } = err.data as Record<string, unknown>;
  return error === "alias_taken";
}

/** Does NOT increment clicks - safe to call for dashboard listings. */
export function getLinkStats(code: string): Promise<LinkStats> {
  return apiFetch<LinkStats>(urlEndpoints.stats(code));
}

export function deleteLink(code: string, token: string): Promise<void> {
  return apiFetch<void>(urlEndpoints.delete(code), {
    method: "DELETE",
    headers: { "X-Delete-Token": token },
  });
}

/** INCREMENTS clicks - only use this for actually resolving a redirect. */
export function getLinkForRedirect(code: string): Promise<LinkRedirectInfo> {
  return apiFetch<LinkRedirectInfo>(urlEndpoints.resolve(code));
}

/**
 * Updates a link's URL and/or expiry. `payload` should only include the
 * fields that actually changed - omitting a field leaves it unchanged on the
 * backend, and re-sending an unchanged past expiry would otherwise trip the
 * "must be in the future" validation.
 */
export function updateLink(
  code: string,
  token: string,
  payload: UpdateLinkRequest
): Promise<UpdateLinkResponse> {
  return apiFetch<UpdateLinkResponse>(urlEndpoints.update(code), {
    method: "PATCH",
    headers: { "X-Delete-Token": token },
    body: payload,
  });
}
