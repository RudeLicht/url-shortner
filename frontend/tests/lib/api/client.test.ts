import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, isBackendNotFound } from "@/lib/api/client";

type MockResponseInit = {
  status: number;
  statusText?: string;
  body?: string;
};

function mockResponse({ status, statusText = "", body }: MockResponseInit) {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    text: async () => body ?? "",
  } as Response;
}

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: JSON.stringify({ hello: "world" }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ hello: string }>("/api/v1/thing");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/thing",
      expect.objectContaining({ headers: {} })
    );
  });

  it("calls the backend directly via BACKEND_INTERNAL_URL when running on the server", async () => {
    vi.stubGlobal("window", undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: JSON.stringify({ hello: "world" }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/thing");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/v1/thing",
      expect.anything()
    );
  });

  it("returns undefined for a 204 response without reading the body", async () => {
    const textSpy = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      text: textSpy,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<void>("/api/v1/thing/abc", { method: "DELETE" });

    expect(result).toBeUndefined();
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("sends a JSON content-type header and serialized body when a body is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 201, body: JSON.stringify({ ok: true }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/url/", {
      method: "POST",
      body: { url: "https://example.com" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/url/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      })
    );
  });

  it("throws an ApiError with the parsed JSON body and status on a non-OK JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 409,
        body: JSON.stringify({ message: "URL already shortened", code: "abc123" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiFetch("/api/v1/url/").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "URL already shortened",
      isJson: true,
      data: { message: "URL already shortened", code: "abc123" },
    });
  });

  it("falls back to statusText when a non-OK JSON body has no message/detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 500, statusText: "Internal Server Error", body: "{}" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error: ApiError = await apiFetch("/api/v1/thing").catch((e) => e);

    expect(error.message).toBe("Internal Server Error");
  });

  it("handles a non-JSON error body (e.g. a proxy's HTML error page) without throwing while parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 502, statusText: "Bad Gateway", body: "<html>Bad Gateway</html>" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error: ApiError = await apiFetch("/api/v1/thing").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.isJson).toBe(false);
    expect(error.data).toBeUndefined();
    expect(error.message).toBe("Bad Gateway");
  });

  it("extracts a message from FastAPI's {detail} shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 400, body: JSON.stringify({ detail: "Bad input" }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error: ApiError = await apiFetch("/api/v1/thing").catch((e) => e);
    expect(error.message).toBe("Bad input");
  });

  it("extracts a message from FastAPI's validation-error {detail: [{msg}]} shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 422,
        body: JSON.stringify({ detail: [{ msg: "field required" }] }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error: ApiError = await apiFetch("/api/v1/thing").catch((e) => e);
    expect(error.message).toBe("field required");
  });
});

describe("isBackendNotFound", () => {
  it("is true for a backend JSON 404", () => {
    const error = new ApiError(404, "URL not found", true, { message: "URL not found" });
    expect(isBackendNotFound(error)).toBe(true);
  });

  it("is false for a non-JSON 404 (e.g. a proxy's error page)", () => {
    const error = new ApiError(404, "Not Found", false, undefined);
    expect(isBackendNotFound(error)).toBe(false);
  });

  it("is false for a JSON error that isn't a 404", () => {
    const error = new ApiError(409, "Conflict", true, { message: "Conflict" });
    expect(isBackendNotFound(error)).toBe(false);
  });

  it("is false for a non-ApiError value", () => {
    expect(isBackendNotFound(new Error("network down"))).toBe(false);
  });
});
