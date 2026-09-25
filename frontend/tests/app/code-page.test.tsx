import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";

const getLinkForRedirectMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  getLinkForRedirect: getLinkForRedirectMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import CodePage from "@/app/[code]/page";

describe("CodePage", () => {
  beforeEach(() => {
    getLinkForRedirectMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects to the resolved destination on success", async () => {
    getLinkForRedirectMock.mockResolvedValue({
      url: "https://example.com/destination",
      code: "abc123",
      expiry: null,
    });

    await CodePage({ params: Promise.resolve({ code: "abc123" }) });

    expect(getLinkForRedirectMock).toHaveBeenCalledWith("abc123");
    expect(redirectMock).toHaveBeenCalledWith("https://example.com/destination");
  });

  it("renders a not-found state for a 404 from the backend", async () => {
    getLinkForRedirectMock.mockRejectedValue(
      new ApiError(404, "URL not found", true, { message: "URL not found" })
    );

    const result = await CodePage({ params: Promise.resolve({ code: "missing" }) });
    render(result);

    expect(screen.getByText("Link not found")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renders a not-found state for a reserved code, without calling the backend", async () => {
    const result = await CodePage({ params: Promise.resolve({ code: "dashboard" }) });
    render(result);

    expect(screen.getByText("Link not found")).toBeInTheDocument();
    expect(getLinkForRedirectMock).not.toHaveBeenCalled();
  });

  it("renders an expired state for a 410 from the backend", async () => {
    getLinkForRedirectMock.mockRejectedValue(
      new ApiError(410, "URL has expired", true, { message: "URL has expired" })
    );

    const result = await CodePage({ params: Promise.resolve({ code: "old123" }) });
    render(result);

    expect(screen.getByText("This link has expired")).toBeInTheDocument();
  });

  it("renders an invalid-destination state for a non-http(s) resolved URL", async () => {
    getLinkForRedirectMock.mockResolvedValue({
      url: "javascript:alert(1)",
      code: "bad123",
      expiry: null,
    });

    const result = await CodePage({ params: Promise.resolve({ code: "bad123" }) });
    render(result);

    expect(screen.getByText("Invalid destination")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renders an invalid-destination state for an unparsable resolved URL", async () => {
    getLinkForRedirectMock.mockResolvedValue({
      url: "not a url",
      code: "bad456",
      expiry: null,
    });

    const result = await CodePage({ params: Promise.resolve({ code: "bad456" }) });
    render(result);

    expect(screen.getByText("Invalid destination")).toBeInTheDocument();
  });

  it("renders a generic error state for an unknown failure", async () => {
    getLinkForRedirectMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await CodePage({ params: Promise.resolve({ code: "abc123" }) });
    render(result);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
