import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import HomePage from "@/app/page";
import { ApiError } from "@/lib/api/client";
import { addTrackedCode, getTrackedCodes } from "@/features/links/utils";

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
    addTrackedCode("abc123");
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
    addTrackedCode("abc123");
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
    addTrackedCode("abc123");
    addTrackedCode("def456");
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
    addTrackedCode("gone123");
    getLinkStatsMock.mockRejectedValue(
      new ApiError(404, "URL not found", true, { message: "URL not found" })
    );

    render(<HomePage />);

    expect(await screen.findByText("No links yet")).toBeInTheDocument();
    expect(getTrackedCodes()).toEqual([]);
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
    addTrackedCode("abc123");
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
    addTrackedCode("abc123");
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

  it("refetches quietly when the tab becomes visible again", async () => {
    addTrackedCode("abc123");
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
