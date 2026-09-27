import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { LinksTable } from "@/features/links/components/links-table";
import { getTrackedEntries, addTrackedEntry } from "@/features/links/utils";
import { ApiError } from "@/lib/api/client";
import type { TrackedLink } from "@/features/links/types";

const deleteLinkMock = vi.hoisted(() => vi.fn());
const updateLinkMock = vi.hoisted(() => vi.fn());
const getExistingCodeFromConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  deleteLink: deleteLinkMock,
  updateLink: updateLinkMock,
  getExistingCodeFromConflict: getExistingCodeFromConflictMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const activeLink: TrackedLink = {
  code: "active1",
  url: "https://example.com/active",
  clicks: 3,
  expiry: null,
  token: "token-active1",
};

const expiredLink: TrackedLink = {
  code: "expired1",
  url: "https://example.com/expired",
  clicks: 10,
  expiry: "2000-01-01T00:00:00Z",
  token: "token-expired1",
};

const sharedLink: TrackedLink = {
  code: "shared1",
  url: "https://example.com/shared",
  clicks: 7,
  expiry: null,
  token: null,
};

describe("LinksTable", () => {
  beforeEach(() => {
    deleteLinkMock.mockReset();
    updateLinkMock.mockReset();
    getExistingCodeFromConflictMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    window.localStorage.clear();
  });

  it("renders a row per link with url, clicks, and short link", () => {
    render(
      <LinksTable links={[activeLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
    );

    expect(screen.getByText("/active1")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/active")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an Expired badge only for links past their expiry", () => {
    render(
      <LinksTable
        links={[activeLink, expiredLink]}
        onRemoved={vi.fn()}
        onReadOnly={vi.fn()}
      />
    );

    expect(screen.getByText("Expired")).toBeInTheDocument();
    // Only one expired badge should be rendered, for expiredLink.
    expect(screen.getAllByText("Expired")).toHaveLength(1);
  });

  it("shows the Expired badge the moment a link expires, without new props", () => {
    vi.useFakeTimers();
    try {
      const soonLink: TrackedLink = {
        code: "soon1",
        url: "https://example.com/soon",
        clicks: 0,
        expiry: new Date(Date.now() + 5_000).toISOString(),
        token: "token-soon1",
      };

      render(
        <LinksTable links={[soonLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
      );
      expect(screen.queryByText("Expired")).not.toBeInTheDocument();
      expect(screen.getByText("in less than a minute")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      expect(screen.getByText("Expired")).toBeInTheDocument();
      expect(screen.queryByText("in less than a minute")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies the short link to the clipboard", async () => {
    // userEvent.setup() installs its own Clipboard stub on `navigator.clipboard`
    // (jsdom doesn't implement the Clipboard API), so the spy must be attached
    // to it *after* setup() runs rather than by pre-stubbing `navigator.clipboard`.
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");

    render(
      <LinksTable links={[activeLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Copy short link" }));

    expect(writeTextSpy).toHaveBeenCalledWith(`${window.location.origin}/active1`);
    expect(toast.success).toHaveBeenCalledWith("Copied to clipboard");
  });

  it("deletes a link after confirming, and notifies the parent", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockResolvedValue(undefined);
    const onRemoved = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledWith("active1");
    });
    expect(deleteLinkMock).toHaveBeenCalledWith("active1", "token-active1");
    expect(toast.success).toHaveBeenCalledWith("Link deleted");
  });

  it("treats a backend 404 on delete as a successful delete", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(
      new ApiError(404, "URL not found", true, { message: "URL not found" })
    );
    const onRemoved = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledWith("active1");
    });
    expect(toast.success).toHaveBeenCalledWith("Link deleted");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows a generic error toast and leaves the dialog usable when delete fails for a non-404, non-JSON-403 reason", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(new ApiError(500, "boom", true, {}));
    const onRemoved = vi.fn();
    const onReadOnly = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={onReadOnly} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't delete link, please try again");
    });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onReadOnly).not.toHaveBeenCalled();
    // The dialog is left open/usable, not dismissed, so the user can retry.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("on a 429 from the proxy's rate limiter, shows the friendly message and leaves the entry untouched (not read-only, not removed)", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(
      new ApiError(429, "Too many requests, try again in 12 seconds.", true, {
        message: "Too many requests, try again in 12 seconds.",
      })
    );
    const onRemoved = vi.fn();
    const onReadOnly = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={onReadOnly} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Too many requests, try again in 12 seconds.");
    });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onReadOnly).not.toHaveBeenCalled();
  });

  it("on a backend (JSON) 403, downgrades the entry to read-only instead of treating it as deleted", async () => {
    const user = userEvent.setup();
    addTrackedEntry("active1", "token-active1");
    deleteLinkMock.mockRejectedValue(
      new ApiError(403, "Forbidden", true, { message: "Forbidden" })
    );
    const onRemoved = vi.fn();
    const onReadOnly = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={onReadOnly} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "You can't delete this link",
        expect.objectContaining({ description: expect.any(String) })
      );
    });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onReadOnly).toHaveBeenCalledWith("active1");
    expect(getTrackedEntries()).toEqual([{ code: "active1", token: null }]);
  });

  it("re-renders a downgraded entry with a Read-only badge and a Remove from list action", async () => {
    const onRemoved = vi.fn();

    const { rerender } = render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Delete link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit link" })).toBeInTheDocument();

    rerender(
      <LinksTable
        links={[{ ...activeLink, token: null }]}
        onRemoved={onRemoved}
        onReadOnly={vi.fn()}
      />
    );

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeInTheDocument();
  });

  it("on a backend (JSON) 403 while editing, downgrades the entry to read-only and closes the dialog", async () => {
    const user = userEvent.setup();
    addTrackedEntry("active1", "token-active1");
    updateLinkMock.mockRejectedValue(
      new ApiError(403, "Forbidden", true, { message: "Forbidden" })
    );
    const onRemoved = vi.fn();
    const onReadOnly = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={onReadOnly} />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));
    const urlInput = await screen.findByLabelText("Destination URL");
    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/changed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onReadOnly).toHaveBeenCalledWith("active1");
    });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(getTrackedEntries()).toEqual([{ code: "active1", token: null }]);
    // The dialog closes on a 403 rather than staying open for a retry.
    expect(screen.queryByLabelText("Destination URL")).not.toBeInTheDocument();
  });

  it("shows a generic error toast (not an ownership refusal) when delete fails with a non-JSON 403, e.g. a proxy challenge page", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(new ApiError(403, "Just a moment...", false));
    const onRemoved = vi.fn();
    const onReadOnly = vi.fn();

    render(
      <LinksTable links={[activeLink]} onRemoved={onRemoved} onReadOnly={onReadOnly} />
    );

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't delete link, please try again");
    });
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onReadOnly).not.toHaveBeenCalled();
    // The entry keeps its token and Delete stays available for a retry.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows a Read-only badge and a Remove from list action for read-only links, with no Delete button", async () => {
    const user = userEvent.setup();
    const onRemoved = vi.fn();

    render(
      <LinksTable links={[sharedLink]} onRemoved={onRemoved} onReadOnly={vi.fn()} />
    );

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit link" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove from list" }));

    expect(deleteLinkMock).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalledWith("shared1");
    expect(toast.success).toHaveBeenCalledWith("Removed from your list");
  });

  it("clicking Remove from list removes the entry from localStorage, without calling the API", async () => {
    const user = userEvent.setup();
    addTrackedEntry("shared1", null);

    render(
      <LinksTable links={[sharedLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Remove from list" }));

    expect(deleteLinkMock).not.toHaveBeenCalled();
    expect(getTrackedEntries()).toEqual([]);
  });

  it("opens the QR code dialog from a row and shows a QR code and Download PNG button for that link's short URL", async () => {
    const user = userEvent.setup();

    render(
      <LinksTable links={[activeLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Show QR code" }));

    const shortUrl = `${window.location.origin}/active1`;
    expect(await screen.findByRole("img", { name: shortUrl })).toBeInTheDocument();
    expect(screen.getByText(shortUrl, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PNG" })).toBeInTheDocument();
  });

  it("shows the QR code action for read-only rows too", () => {
    render(
      <LinksTable links={[sharedLink]} onRemoved={vi.fn()} onReadOnly={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: "Show QR code" })).toBeInTheDocument();
  });

  it("renders a mixed list with Delete link only for owned rows, and Read-only/Remove from list only for read-only rows", () => {
    render(
      <LinksTable
        links={[activeLink, sharedLink]}
        onRemoved={vi.fn()}
        onReadOnly={vi.fn()}
      />
    );

    // Exactly one owned row -> exactly one Delete link button.
    expect(screen.getAllByRole("button", { name: "Delete link" })).toHaveLength(1);
    // Exactly one read-only row -> exactly one Read-only badge and Remove action.
    expect(screen.getAllByText("Read-only")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove from list" })).toHaveLength(1);

    const activeRow = screen.getByText("/active1").closest("tr")!;
    const sharedRow = screen.getByText("/shared1").closest("tr")!;

    expect(within(activeRow).getByRole("button", { name: "Delete link" })).toBeInTheDocument();
    expect(within(activeRow).queryByRole("button", { name: "Remove from list" })).not.toBeInTheDocument();
    expect(within(activeRow).queryByText("Read-only")).not.toBeInTheDocument();

    expect(within(sharedRow).getByRole("button", { name: "Remove from list" })).toBeInTheDocument();
    expect(within(sharedRow).queryByRole("button", { name: "Delete link" })).not.toBeInTheDocument();
    expect(within(sharedRow).getByText("Read-only")).toBeInTheDocument();
  });
});
