// The backend has no public URL. In the browser, calls go to this app's own
// /api/* route (app/api/[...path]/route.ts), which forwards them privately.
// Server-side code (e.g. app/[code]) calls the backend directly.
function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  const backendUrl = process.env.BACKEND_INTERNAL_URL;
  if (!backendUrl) {
    throw new Error("BACKEND_INTERNAL_URL is not set");
  }
  return backendUrl;
}

export class ApiError extends Error {
  status: number;
  /** True when the response body parsed as JSON (i.e. it's the backend's own error shape, not a proxy's HTML/plain-text error page). */
  isJson: boolean;
  /** The parsed JSON error body, when `isJson` is true (e.g. `{"message": "...", "code": "..."}`). */
  data?: unknown;

  constructor(status: number, message: string, isJson: boolean, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isJson = isJson;
    this.data = data;
  }
}

/**
 * True when `err` is the backend's own "not found" response - a 404 whose
 * body actually parsed as JSON. A reverse proxy (e.g. Traefik returning a
 * "no available server" page during a deploy) can also produce a 404, but
 * with a non-JSON body, and should not be treated as a genuine not-found.
 */
export function isBackendNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.isJson;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

/**
 * Attempts to pull a human-readable message out of the backend's error
 * body. The backend returns shapes like {"message": "..."} or
 * {"detail": "..."} (the latter from FastAPI's own validation errors).
 */
function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;

    if (typeof record.message === "string") {
      return record.message;
    }

    if (typeof record.detail === "string") {
      return record.detail;
    }

    if (Array.isArray(record.detail)) {
      const first = record.detail[0];
      if (first && typeof first === "object" && typeof (first as Record<string, unknown>).msg === "string") {
        return (first as Record<string, unknown>).msg as string;
      }
    }
  }

  return fallback;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, headers, ...rest } = options;

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();

  // The body isn't guaranteed to be JSON - a reverse proxy can return an
  // HTML error page (e.g. a 502) instead of the backend's own error shape.
  // Parse defensively so a malformed body never masks the real status.
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractErrorMessage(
        data,
        response.statusText || `Request failed with status ${response.status}`
      ),
      data !== undefined,
      data
    );
  }

  return data as T;
}
