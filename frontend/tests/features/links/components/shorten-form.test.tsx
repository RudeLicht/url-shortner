import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ShortenForm } from "@/features/links/components/shorten-form";
import { ApiError } from "@/lib/api/client";
import { addTrackedEntry, getTrackedEntries } from "@/features/links/utils";

const shortenUrlMock = vi.hoisted(() => vi.fn());
const getExistingCodeFromConflictMock = vi.hoisted(() => vi.fn());
const isAliasTakenConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  shortenUrl: shortenUrlMock,
  getExistingCodeFromConflict: getExistingCodeFromConflictMock,
  isAliasTakenConflict: isAliasTakenConflictMock,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("ShortenForm", () => {
  beforeEach(() => {
    shortenUrlMock.mockReset();
    getExistingCodeFromConflictMock.mockReset();
    isAliasTakenConflictMock.mockReset();
    isAliasTakenConflictMock.mockReturnValue(false);
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("shortens a URL and shows/tracks the resulting short link", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
      delete_token: "token-abc123",
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
    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-abc123" }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("stores a null token when the backend response omits delete_token (an older, pre-token backend)", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
      // delete_token intentionally omitted, as an older backend would.
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/abc123`)).toBeInTheDocument();
    });

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("stores a null token when the backend response has an empty-string delete_token", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "abc123",
      expiry: null,
      delete_token: "",
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/abc123`)).toBeInTheDocument();
    });

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
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
      delete_token: "token-abc123",
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
      delete_token: "token-abc123",
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
      delete_token: "token-abc123",
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

  it("on a 409 conflict for a code this browser doesn't already own, tracks it read-only", async () => {
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
    // The backend checks URL uniqueness before the alias, so a submitted
    // alias here is silently dropped - the toast must say so explicitly.
    await user.type(screen.getByLabelText("Custom alias"), "promo");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/existing1`)).toBeInTheDocument();
    });

    expect(getTrackedEntries()).toEqual([{ code: "existing1", token: null }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "This URL was already shortened by someone else",
      expect.objectContaining({
        description: expect.stringContaining(
          'Your custom alias "promo" was not created.'
        ),
      })
    );
  });

  it("on a 409 conflict for a code this browser already owns, keeps the existing-link message and the token", async () => {
    const user = userEvent.setup();
    addTrackedEntry("existing1", "token-existing1");
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

    expect(getTrackedEntries()).toEqual([{ code: "existing1", token: "token-existing1" }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "This URL already has a short link",
      expect.objectContaining({ description: undefined })
    );
  });

  it("on a 409 conflict for a code this browser already owns and a custom alias was submitted, mentions the alias wasn't created", async () => {
    const user = userEvent.setup();
    addTrackedEntry("existing1", "token-existing1");
    const conflictError = new ApiError(409, "URL already shortened", true, {
      message: "URL already shortened",
      code: "existing1",
    });
    shortenUrlMock.mockRejectedValue(conflictError);
    getExistingCodeFromConflictMock.mockReturnValue("existing1");

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.type(screen.getByLabelText("Custom alias"), "promo");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText(`${window.location.origin}/existing1`)).toBeInTheDocument();
    });

    expect(toast.info).toHaveBeenCalledWith(
      "This URL already has a short link",
      expect.objectContaining({
        description: 'Your custom alias "promo" was not created.',
      })
    );

    // Re-submitting with an alias that matches the existing code itself
    // must not claim an alias "wasn't created" - it already is that code.
    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.type(screen.getByLabelText("Custom alias"), "existing1");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(toast.info).toHaveBeenLastCalledWith(
        "This URL already has a short link",
        expect.objectContaining({ description: undefined })
      );
    });
  });

  it("on a 409 conflict for a code already in the list read-only (legacy entry), keeps the existing-link message rather than 'shortened by someone else'", async () => {
    const user = userEvent.setup();
    // A legacy/read-only entry this browser already knows about, but with
    // no token - it must not be told this is new to it.
    addTrackedEntry("existing1", null);
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

    expect(getTrackedEntries()).toEqual([{ code: "existing1", token: null }]);
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
    expect(getTrackedEntries()).toEqual([]);
  });

  it("shows a generic form error when the server returns an unexpected error", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockRejectedValue(new ApiError(500, "Error shortening the URL", true, {}));

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("Error shortening the URL")).toBeInTheDocument();
  });

  it("shows a friendly message when the proxy rate-limits this browser", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockRejectedValue(
      new ApiError(429, "Too many requests, try again in 30 seconds.", true, {
        message: "Too many requests, try again in 30 seconds.",
      })
    );

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(
      await screen.findByText("Too many requests, try again in 30 seconds.")
    ).toBeInTheDocument();
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

  it("sends a valid custom alias in the payload and shows a live preview of the resulting short link, trimming trailing whitespace", async () => {
    const user = userEvent.setup();
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "my-link",
      expiry: null,
      delete_token: "token-my-link",
    });

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    // Trailing whitespace should be trimmed consistently for the preview,
    // validation and payload rather than only some of them.
    await user.type(screen.getByLabelText("Custom alias"), "my-link ");

    expect(screen.getByText(`${window.location.origin}/my-link`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => expect(shortenUrlMock).toHaveBeenCalledTimes(1));
    expect(shortenUrlMock).toHaveBeenCalledWith({
      url: "https://example.com",
      expiry: undefined,
      alias: "my-link",
    });
  });

  it("shows a field error on the alias input when the alias is already taken, without tracking the link", async () => {
    const user = userEvent.setup();
    const aliasTakenError = new ApiError(409, "Alias already taken", true, {
      message: "Alias already taken",
      error: "alias_taken",
    });
    shortenUrlMock.mockRejectedValue(aliasTakenError);
    getExistingCodeFromConflictMock.mockReturnValue(null);
    isAliasTakenConflictMock.mockReturnValue(true);

    render(<ShortenForm onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.type(screen.getByLabelText("Custom alias"), "taken");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    expect(await screen.findByText("That alias is already taken")).toBeInTheDocument();
    expect(getTrackedEntries()).toEqual([]);
  });

  it.each([
    ["a!", "https://example.com"],
    ["api", "https://example.com"],
    // An invalid alias alongside an invalid URL: the alias check is a
    // field-level refine, so it must still surface even though the URL
    // field is also invalid.
    ["a!", "not a url"],
  ])(
    "shows a client-side validation error for an invalid alias (%s) without calling the API",
    async (alias, url) => {
      const user = userEvent.setup();
      render(<ShortenForm onCreated={vi.fn()} />);

      await user.type(screen.getByPlaceholderText("Paste a long URL..."), url);
      await user.type(screen.getByLabelText("Custom alias"), alias);
      await user.click(screen.getByRole("button", { name: "Shorten" }));

      // The exact error text, not the substring-overlapping "Optional, ..."
      // hint shown when the alias field has no error.
      expect(
        await screen.findByText(
          "Alias must be 3-20 letters, numbers, - or _, and not a reserved word"
        )
      ).toBeInTheDocument();
      if (url === "not a url") {
        expect(
          screen.getByText("Enter a valid http:// or https:// URL")
        ).toBeInTheDocument();
      }
      expect(shortenUrlMock).not.toHaveBeenCalled();
    }
  );
});
