import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import HomePage from "@/app/page";
import { ApiError } from "@/lib/api/client";
import { addTrackedEntry, getTrackedEntries } from "@/features/links/utils";

const getLinkStatsMock = vi.hoisted(() => vi.fn());
const deleteLinkMock = vi.hoisted(() => vi.fn());
const shortenUrlMock = vi.hoisted(() => vi.fn());
const getExistingCodeFromConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  getLinkStats: getLinkStatsMock,
  deleteLink: deleteLinkMock,
  shortenUrl: shortenUrlMock,
  getExistingCodeFromConflict: getExistingCodeFromConflictMock,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("HomePage", () => {
  beforeEach(() => {
    getLinkStatsMock.mockReset();
    deleteLinkMock.mockReset();
    shortenUrlMock.mockReset();
    getExistingCodeFromConflictMock.mockReset();
    vi.mocked(toast.error).mockReset();
    window.localStorage.clear();
  });

  it("shows an empty state when there are no tracked links", async () => {
    render(<HomePage />);

    expect(screen.getByText("Loading your links...")).toBeInTheDocument();
    expect(await screen.findByText("No links yet")).toBeInTheDocument();
  });

  it("renders the links table once tracked codes resolve", async () => {
    addTrackedEntry("abc123", null);
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    render(<HomePage />);

    expect(await screen.findByText("/abc123")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows a full-page error with a retry button when every fetch fails (non-404)", async () => {
    addTrackedEntry("abc123", null);
    getLinkStatsMock.mockRejectedValue(new ApiError(500, "boom", true, {}));

    render(<HomePage />);

    expect(await screen.findByText("Couldn't load your links")).toBeInTheDocument();

    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 0,
      expiry: null,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("/abc123")).toBeInTheDocument();
  });

  it("shows a partial-failure notice when some (but not all) links fail to load", async () => {
    addTrackedEntry("abc123", null);
    addTrackedEntry("def456", null);
    getLinkStatsMock.mockImplementation(async (code: string) => {
      if (code === "abc123") {
        return { url: "https://example.com", clicks: 1, expiry: null };
      }
      throw new ApiError(500, "boom", true, {});
    });

    render(<HomePage />);

    expect(
      await screen.findByText(
        "Some of your links couldn't be loaded. They're hidden for now - try refreshing in a moment."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("/abc123")).toBeInTheDocument();
  });

  it("silently removes stale codes that 404 from tracked storage", async () => {
    addTrackedEntry("gone123", null);
    getLinkStatsMock.mockRejectedValue(
      new ApiError(404, "URL not found", true, { message: "URL not found" })
    );

    render(<HomePage />);

    expect(await screen.findByText("No links yet")).toBeInTheDocument();
    expect(getTrackedEntries()).toEqual([]);
  });

  it("refreshes the list after successfully shortening a new URL", async () => {
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 0,
      expiry: null,
    });
    shortenUrlMock.mockResolvedValue({
      url: "https://example.com",
      short_url: "newcode1",
      expiry: null,
      delete_token: "token-newcode1",
    });

    const user = userEvent.setup();
    render(<HomePage />);

    expect(await screen.findByText("No links yet")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Paste a long URL..."), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Shorten" }));

    await waitFor(() => {
      expect(screen.getByText("/newcode1")).toBeInTheDocument();
    });
    expect(getLinkStatsMock).toHaveBeenCalledWith("newcode1");
  });

  it("refreshes the stats in place when Refresh is clicked", async () => {
    addTrackedEntry("abc123", null);
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText("5")).toBeInTheDocument();

    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 9,
      expiry: null,
    });
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("9")).toBeInTheDocument();
    expect(screen.queryByText("Loading your links...")).not.toBeInTheDocument();
  });

  it("keeps the table and shows a toast when a manual refresh fails", async () => {
    addTrackedEntry("abc123", null);
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText("/abc123")).toBeInTheDocument();

    getLinkStatsMock.mockRejectedValue(new ApiError(500, "boom", true, {}));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't refresh your links");
    });
    expect(screen.getByText("/abc123")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your links")).not.toBeInTheDocument();
  });

  it("does not restore a token that was downgraded to read-only while a refresh was in flight", async () => {
    addTrackedEntry("abc123", "token-abc123");
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    const user = userEvent.setup();
    render(<HomePage />);
    expect(
      await screen.findByRole("button", { name: "Delete link" })
    ).toBeInTheDocument();

    let resolveStats: (value: {
      url: string;
      clicks: number;
      expiry: string | null;
    }) => void = () => {};
    const deferredStats = new Promise<{
      url: string;
      clicks: number;
      expiry: string | null;
    }>((resolve) => {
      resolveStats = resolve;
    });
    getLinkStatsMock.mockReturnValue(deferredStats);

    // Kick off a refresh, but its stats request stays pending below.
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    // While that refresh is still in flight, the backend rejects this
    // browser's delete token, downgrading the entry to read-only.
    deleteLinkMock.mockRejectedValue(
      new ApiError(403, "Forbidden", true, { message: "Forbidden" })
    );
    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Read-only")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete link" })
    ).not.toBeInTheDocument();

    // Now let the stale refresh finish - it must not resurrect the token.
    resolveStats({ url: "https://example.com", clicks: 9, expiry: null });

    await waitFor(() => {
      expect(screen.getByText("9")).toBeInTheDocument();
    });
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete link" })
    ).not.toBeInTheDocument();
  });

  it("does not resurrect a link that was removed while a refresh was in flight", async () => {
    addTrackedEntry("abc123", "token-abc123");
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText("/abc123")).toBeInTheDocument();

    let resolveStats: (value: {
      url: string;
      clicks: number;
      expiry: string | null;
    }) => void = () => {};
    const deferredStats = new Promise<{
      url: string;
      clicks: number;
      expiry: string | null;
    }>((resolve) => {
      resolveStats = resolve;
    });
    getLinkStatsMock.mockReturnValue(deferredStats);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    deleteLinkMock.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("No links yet")).toBeInTheDocument();

    resolveStats({ url: "https://example.com", clicks: 9, expiry: null });

    await waitFor(() => {
      expect(getLinkStatsMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("No links yet")).toBeInTheDocument();
    expect(screen.queryByText("/abc123")).not.toBeInTheDocument();
  });

  it("does not remove a link that was re-tracked with a fresh token while its stats request was in flight and then 404'd", async () => {
    addTrackedEntry("abc123", "token-old");
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText("/abc123")).toBeInTheDocument();

    let rejectStats: (reason: unknown) => void = () => {};
    const deferredStats = new Promise((_, reject) => {
      rejectStats = reject;
    });
    getLinkStatsMock.mockReturnValue(deferredStats);

    // Kick off a refresh; its stats request for "abc123" stays pending.
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    // While that request is in flight, the code gets reused (e.g. deleted
    // and re-shortened) and re-tracked with a fresh token.
    addTrackedEntry("abc123", "token-fresh");

    // Now the stale in-flight request settles as a 404.
    rejectStats(new ApiError(404, "URL not found", true, { message: "URL not found" }));

    // Wait for the refresh triggered above to finish processing.
    await waitFor(() => {
      expect(screen.queryByText("Refreshing...")).not.toBeInTheDocument();
    });

    // The fresh entry (and its delete token) must survive the stale 404,
    // not be wiped out by it.
    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-fresh" }]);
  });

  it("refetches quietly when the tab becomes visible again", async () => {
    addTrackedEntry("abc123", null);
    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 5,
      expiry: null,
    });

    render(<HomePage />);
    expect(await screen.findByText("5")).toBeInTheDocument();

    getLinkStatsMock.mockResolvedValue({
      url: "https://example.com",
      clicks: 12,
      expiry: null,
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(await screen.findByText("12")).toBeInTheDocument();
    } finally {
      visibility.mockRestore();
    }
  });
});
