// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/[...path]/route";
import { resetRateLimitState } from "@/lib/rate-limit";

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) } as RouteContext<"/api/[...path]">;
}

describe("API proxy route", () => {
  beforeEach(() => {
    resetRateLimitState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("forwards a GET to the backend with the same path and query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ clicks: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://frontend.test/api/v1/url/stats/abc?x=1"),
      ctx(["v1", "url", "stats", "abc"])
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/v1/url/stats/abc?x=1",
      expect.objectContaining({ method: "GET", body: undefined })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clicks: 3 });
  });

  it("forwards a POST body and content-type, and passes the backend status through", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ message: "URL already shortened" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://frontend.test/api/v1/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
      ctx(["v1", "url"])
    );

    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("http://backend.test/api/v1/url");
    expect(init.method).toBe("POST");
    expect(init.headers.get("content-type")).toBe("application/json");
    expect(new TextDecoder().decode(init.body)).toBe(JSON.stringify({ url: "https://example.com" }));
    expect(response.status).toBe(409);
  });

  it("forwards the X-Delete-Token header to the backend on DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await DELETE(
      new Request("http://frontend.test/api/v1/url/abc", {
        method: "DELETE",
        headers: { "X-Delete-Token": "secret-token" },
      }),
      ctx(["v1", "url", "abc"])
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get("x-delete-token")).toBe("secret-token");
  });

  it("forwards a PATCH body and the X-Delete-Token header to the backend", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ url: "https://example.com/new", code: "abc", expiry: null }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await PATCH(
      new Request("http://frontend.test/api/v1/url/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Delete-Token": "secret-token" },
        body: JSON.stringify({ url: "https://example.com/new" }),
      }),
      ctx(["v1", "url", "abc"])
    );

    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("http://backend.test/api/v1/url/abc");
    expect(init.method).toBe("PATCH");
    expect(init.headers.get("x-delete-token")).toBe("secret-token");
    expect(new TextDecoder().decode(init.body)).toBe(
      JSON.stringify({ url: "https://example.com/new" })
    );
    expect(response.status).toBe(200);
  });

  it("does not forward a non-allowlisted header (e.g. cookie or authorization)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await GET(
      new Request("http://frontend.test/api/v1/url/abc", {
        headers: { cookie: "session=abc123", authorization: "Bearer xyz" },
      }),
      ctx(["v1", "url", "abc"])
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get("cookie")).toBeNull();
    expect(init.headers.get("authorization")).toBeNull();
  });

  it("returns an empty body for a 204 from the backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const response = await DELETE(
      new Request("http://frontend.test/api/v1/url/abc", { method: "DELETE" }),
      ctx(["v1", "url", "abc"])
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("returns a 502 when the backend can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new Request("http://frontend.test/api/v1/url/abc"),
      ctx(["v1", "url", "abc"])
    );

    expect(response.status).toBe(502);
  });

  it("returns a 502 when BACKEND_INTERNAL_URL is not set", async () => {
    vi.stubEnv("BACKEND_INTERNAL_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new Request("http://frontend.test/api/v1/url/abc"),
      ctx(["v1", "url", "abc"])
    );

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate-limits POST: the 11th request from one IP within a minute gets 429 + Retry-After, without calling the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const post = () =>
      POST(
        new Request("http://frontend.test/api/v1/url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "9.9.9.9",
          },
          body: JSON.stringify({ url: "https://example.com" }),
        }),
        ctx(["v1", "url"])
      );

    for (let i = 0; i < 10; i++) {
      const response = await post();
      expect(response.status).not.toBe(429);
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);

    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({
      message: expect.stringContaining("Too many requests"),
    });
    // The backend must not have been called for the blocked request.
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("never rate-limits GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < 15; i++) {
      const response = await GET(
        new Request("http://frontend.test/api/v1/url/stats/abc", {
          headers: { "x-forwarded-for": "1.1.1.1" },
        }),
        ctx(["v1", "url", "stats", "abc"])
      );
      expect(response.status).not.toBe(429);
    }
    expect(fetchMock).toHaveBeenCalledTimes(15);
  });

  it("keys the rate limit by cf-connecting-ip, falling back to x-forwarded-for", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const post = (headers: Record<string, string>) =>
      POST(
        new Request("http://frontend.test/api/v1/url", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: "{}",
        }),
        ctx(["v1", "url"])
      );

    // Same cf-connecting-ip each time, spoofing a different x-forwarded-for -
    // cf-connecting-ip should win, so this still exhausts a single bucket.
    for (let i = 0; i < 10; i++) {
      await post({ "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": `10.0.0.${i}` });
    }
    const blocked = await post({ "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "10.0.0.99" });
    expect(blocked.status).toBe(429);

    // A request with no cf-connecting-ip falls back to x-forwarded-for, and
    // is tracked independently of the bucket above.
    const other = await post({ "x-forwarded-for": "6.6.6.6" });
    expect(other.status).not.toBe(429);
  });
});
