// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/[...path]/route";

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) } as RouteContext<"/api/[...path]">;
}

describe("API proxy route", () => {
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
});
