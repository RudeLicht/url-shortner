import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ShortenForm } from "@/features/links/components/shorten-form";
import { ApiError } from "@/lib/api/client";
import { getTrackedCodes } from "@/features/links/utils";

const shortenUrlMock = vi.hoisted(() => vi.fn());
const getExistingCodeFromConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  shortenUrl: shortenUrlMock,
  getExistingCodeFromConflict: getExistingCodeFromConflictMock,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("ShortenForm", () => {
  beforeEach(() => {
    shortenUrlMock.mockReset();
    getExistingCodeFromConflictMock.mockReset();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("shortens a URL and shows/tracks the resulting short link", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
    });
    const onCreated = vi.fn();

    render(<ShortenForm onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/abc123`)).toBeInTheDocument();
    });

    expect(shortenUrlMock).toHaveBeenCalledWith({
      url: "https://example.com",
      expiry: undefined,
    });
    expect(getTrackedCodes()).toEqual(["abc123"]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows a client-side validation error for a non-http(s) URL without calling the API", async () => {
    const user = userEvent.setup();
    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "ftp://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("Enter a valid http:// or https:// URL")).toBeInTheDocument();
    expect(shortenUrlMock).not.toHaveBeenCalled();
  });

  it("shows a client-side validation error for a malformed URL", async () => {
    const user = userEvent.setup();
    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "not a url");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("Enter a valid http:// or https:// URL")).toBeInTheDocument();
    expect(shortenUrlMock).not.toHaveBeenCalled();
  });

  it("shows a client-side validation error for a past expiry date", async () => {
    const user = userEvent.setup();
    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Add an expiry date" }));

    const expiryInput = screen.getByLabelText("Expiry");
    await user.type(expiryInput, "2000-01-01T00:00");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("Expiry must be a valid date in the future")
    ).toBeInTheDocument();
    expect(shortenUrlMock).not.toHaveBeenCalled();
  });

  it("on a 409 conflict with an existing code, reuses and tracks that code instead of erroring", async () => {
    const user = userEvent.setup();
    const conflictError = new ApiError(409, "URL already shortened", true, {
      message: "URL already shortened",
      code: "existing1",
    });
    shortenUrlMock.mockRejectedValue(conflictError);
    getExistingCodeFromConflictMock.mockReturnValue("existing1");
    const onCreated = vi.fn();

    render(<ShortenForm onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/existing1`)).toBeInTheDocument();
    });

    expect(getTrackedCodes()).toEqual(["existing1"]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "This URL already has a short link",
      expect.objectContaining({ description: undefined })
    );
  });

  it("on a 409 conflict without a recoverable code, shows a form error instead", async () => {
    const user = userEvent.setup();
    const conflictError = new ApiError(409, "This URL has already been shortened", true, {});
    shortenUrlMock.mockRejectedValue(conflictError);
    getExistingCodeFromConflictMock.mockReturnValue(null);

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("This URL has already been shortened")
    ).toBeInTheDocument();
    expect(getTrackedCodes()).toEqual([]);
  });

  it("shows a generic form error when the server returns an unexpected error", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockRejectedValue(new ApiError(500, "Error shortening the URL", true, {}));

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("Error shortening the URL")).toBeInTheDocument();
  });

  it("shows a fallback error message for a non-ApiError failure", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("Something went wrong. Please try again.")
    ).toBeInTheDocument();
  });
});
