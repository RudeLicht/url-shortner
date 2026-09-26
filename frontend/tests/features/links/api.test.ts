import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    apiFetch: apiFetchMock,
  };
});

import {
  deleteLink,
  getExistingCodeFromConflict,
  getLinkForRedirect,
  getLinkStats,
  shortenUrl,
} from "@/features/links/api";

describe("links api request shapes", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("shortenUrl POSTs to the create endpoint with the payload", async () => {
    apiFetchMock.mockResolvedValue({ url: "https://a.com", short_url: "abc123", expiry: null });

    const result = await shortenUrl({ url: "https://a.com" });

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/url", {
      method: "POST",
      body: { url: "https://a.com" },
    });
    expect(result.short_url).toBe("abc123");
  });

  it("getLinkStats GETs the stats endpoint for the given code", async () => {
    apiFetchMock.mockResolvedValue({ url: "https://a.com", clicks: 3, expiry: null });

    await getLinkStats("abc 123");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/url/stats/abc%20123");
  });

  it("deleteLink DELETEs the resource endpoint for the given code", async () => {
    apiFetchMock.mockResolvedValue(undefined);

    await deleteLink("abc123");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/url/abc123", { method: "DELETE" });
  });

  it("getLinkForRedirect GETs the resolve endpoint for the given code", async () => {
    apiFetchMock.mockResolvedValue({ url: "https://a.com", code: "abc123", expiry: null });

    await getLinkForRedirect("abc123");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/url/abc123");
  });
});

describe("getExistingCodeFromConflict", () => {
  it("extracts the code from a well-formed 409 conflict", () => {
    const err = new ApiError(409, "URL already shortened", true, {
      message: "URL already shortened",
      code: "abc123",
    });

    expect(getExistingCodeFromConflict(err)).toBe("abc123");
  });

  it("returns null for a non-ApiError value", () => {
    expect(getExistingCodeFromConflict(new Error("boom"))).toBeNull();
  });

  it("returns null when the status isn't 409", () => {
    const err = new ApiError(404, "not found", true, { message: "not found" });
    expect(getExistingCodeFromConflict(err)).toBeNull();
  });

  it("returns null when the 409 body isn't JSON", () => {
    const err = new ApiError(409, "Conflict", false, undefined);
    expect(getExistingCodeFromConflict(err)).toBeNull();
  });

  it("returns null when the JSON body has no code field (older backend)", () => {
    const err = new ApiError(409, "URL already shortened", true, {
      message: "URL already shortened",
    });
    expect(getExistingCodeFromConflict(err)).toBeNull();
  });

  it("returns null when the JSON body's code field isn't a non-empty string", () => {
    const err = new ApiError(409, "URL already shortened", true, { code: "" });
    expect(getExistingCodeFromConflict(err)).toBeNull();

    const err2 = new ApiError(409, "URL already shortened", true, { code: 123 });
    expect(getExistingCodeFromConflict(err2)).toBeNull();
  });

  it("returns null when the JSON body isn't an object", () => {
    const err = new ApiError(409, "URL already shortened", true, "just a string");
    expect(getExistingCodeFromConflict(err)).toBeNull();
  });
});
