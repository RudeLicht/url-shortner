import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { LinksTable } from "@/features/links/components/links-table";
import { ApiError } from "@/lib/api/client";
import type { TrackedLink } from "@/features/links/types";

const deleteLinkMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  deleteLink: deleteLinkMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const activeLink: TrackedLink = {
  code: "active1",
  url: "https://example.com/active",
  clicks: 3,
  expiry: null,
};

const expiredLink: TrackedLink = {
  code: "expired1",
  url: "https://example.com/expired",
  clicks: 10,
  expiry: "2000-01-01T00:00:00Z",
};

describe("LinksTable", () => {
  beforeEach(() => {
    deleteLinkMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders a row per link with url, clicks, and short link", () => {
    render(<LinksTable links={[activeLink]} onDeleted={vi.fn()} />);

    expect(screen.getByText("/active1")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/active")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an Expired badge only for links past their expiry", () => {
    render(<LinksTable links={[activeLink, expiredLink]} onDeleted={vi.fn()} />);

    expect(screen.getByText("Expired")).toBeInTheDocument();
    // Only one expired badge should be rendered, for expiredLink.
    expect(screen.getAllByText("Expired")).toHaveLength(1);
  });

  it("copies the short link to the clipboard", async () => {
    // userEvent.setup() installs its own Clipboard stub on `navigator.clipboard`
    // (jsdom doesn't implement the Clipboard API), so the spy must be attached
    // to it *after* setup() runs rather than by pre-stubbing `navigator.clipboard`.
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");

    render(<LinksTable links={[activeLink]} onDeleted={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy short link" }));

    expect(writeTextSpy).toHaveBeenCalledWith(`${window.location.origin}/active1`);
    expect(toast.success).toHaveBeenCalledWith("Copied to clipboard");
  });

  it("deletes a link after confirming, and notifies the parent", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockResolvedValue(undefined);
    const onDeleted = vi.fn();

    render(<LinksTable links={[activeLink]} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("active1");
    });
    expect(deleteLinkMock).toHaveBeenCalledWith("active1");
    expect(toast.success).toHaveBeenCalledWith("Link deleted");
  });

  it("treats a backend 404 on delete as a successful delete", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(
      new ApiError(404, "URL not found", true, { message: "URL not found" })
    );
    const onDeleted = vi.fn();

    render(<LinksTable links={[activeLink]} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("active1");
    });
    expect(toast.success).toHaveBeenCalledWith("Link deleted");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an error toast and keeps the link when delete fails for a non-404 reason", async () => {
    const user = userEvent.setup();
    deleteLinkMock.mockRejectedValue(new ApiError(500, "boom", true, {}));
    const onDeleted = vi.fn();

    render(<LinksTable links={[activeLink]} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete link" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't delete link, please try again");
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
