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

  it("sends a preset expiry relative to the moment of submitting", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByText(/^Expires .+ · in 7 days$/)).toBeInTheDocument();

    const before = Date.now();
    await user.click(screen.getByRole("button", { name: "Shorten" }));
    await waitFor(() => expect(shortenUrlMock).toHaveBeenCalledTimes(1));
    const after = Date.now();

    const sentExpiry = new Date(shortenUrlMock.mock.calls[0][0].expiry).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(sentExpiry).toBeGreaterThanOrEqual(before + sevenDays);
    expect(sentExpiry).toBeLessThanOrEqual(after + sevenDays);
  });

  it("resets the expiry back to Never after a successful shorten", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "1 hour" }));
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("This link won't expire.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Never" })).toHaveAttribute("aria-pressed", "true");
  });

  it("requires a date when a custom expiry is chosen", async () => {
    const user = userEvent.setup();
    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("Expiry must be a valid date in the future")
    ).toBeInTheDocument();
    expect(shortenUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a custom expiry that is already in the past", async () => {
    const user = userEvent.setup();
    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Pick a date" }));
    await user.click(await screen.findByRole("button", { name: /^Today/ }));

    // Midnight today has always already passed.
    const timeInput = screen.getByLabelText("Expiry time");
    await user.clear(timeInput);
    await user.type(timeInput, "00:00");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("Expiry must be a valid date in the future")
    ).toBeInTheDocument();
    expect(shortenUrlMock).not.toHaveBeenCalled();
  });

  it("sends a custom expiry combining the picked date and time", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Pick a date" }));
    // The 1st of next month is always in the future.
    await user.click(await screen.findByRole("button", { name: /next month/i }));
    const firstOfNextMonth = new Date();
    firstOfNextMonth.setHours(0, 0, 0, 0);
    firstOfNextMonth.setDate(1);
    firstOfNextMonth.setMonth(firstOfNextMonth.getMonth() + 1);
    const monthName = firstOfNextMonth.toLocaleDateString("en-US", { month: "long" });
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(`${monthName} 1st, ${firstOfNextMonth.getFullYear()}`),
      })
    );

    const timeInput = screen.getByLabelText("Expiry time");
    await user.clear(timeInput);
    await user.type(timeInput, "09:30");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => expect(shortenUrlMock).toHaveBeenCalledTimes(1));
    const expected = new Date(firstOfNextMonth);
    expected.setHours(9, 30, 0, 0);
    expect(shortenUrlMock.mock.calls[0][0].expiry).toBe(expected.toISOString());
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
