// Forwards the browser's /api/* calls to the backend over the private network,
// so the backend never needs a public URL. BACKEND_INTERNAL_URL is read at
// request time, so changing it doesn't require a rebuild.

import {
  checkRateLimit,
  getClientIp,
  getCreateLimit,
  getModifyLimit,
} from "@/lib/rate-limit";

const STRIPPED_RESPONSE_HEADERS = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  // fetch() already decoded the body, so these no longer describe it.
  "content-encoding",
  "content-length",
];

// GET/HEAD are read-only and never limited. Writes are split into "create"
// (POST) and "modify" (PATCH/PUT/DELETE) so they can have different limits.
const RATE_LIMIT_KIND_BY_METHOD: Record<string, "create" | "modify" | undefined> = {
  POST: "create",
  PUT: "modify",
  PATCH: "modify",
  DELETE: "modify",
};

function getLimitForKind(kind: "create" | "modify"): number {
  return kind === "create" ? getCreateLimit() : getModifyLimit();
}

async function forward(
  request: Request,
  ctx: RouteContext<"/api/[...path]">
): Promise<Response> {
  const rateLimitKind = RATE_LIMIT_KIND_BY_METHOD[request.method];
  if (rateLimitKind) {
    const clientIp = getClientIp(request);
    const result = checkRateLimit(rateLimitKind, clientIp, getLimitForKind(rateLimitKind));
    if (!result.allowed) {
      return Response.json(
        {
          message: `Too many requests, try again in ${result.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        }
      );
    }
  }

  const backendUrl = process.env.BACKEND_INTERNAL_URL;
  if (!backendUrl) {
    console.error("BACKEND_INTERNAL_URL is not set; cannot proxy API request");
    return Response.json({ message: "Backend is not configured" }, { status: 502 });
  }

  const { path } = await ctx.params;
  const { search } = new URL(request.url);
  const target = `${backendUrl}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  for (const name of ["content-type", "accept", "x-delete-token"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
  } catch (error) {
    console.error(`Proxy request to ${target} failed:`, error);
    return Response.json({ message: "Backend unavailable" }, { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(name);
  }

  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
