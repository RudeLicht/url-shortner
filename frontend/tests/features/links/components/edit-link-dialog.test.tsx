import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { EditLinkDialog } from "@/features/links/components/edit-link-dialog";
import { ApiError } from "@/lib/api/client";
import type { TrackedLink } from "@/features/links/types";

const updateLinkMock = vi.hoisted(() => vi.fn());
const getExistingCodeFromConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/links/api", () => ({
  updateLink: updateLinkMock,
  getExistingCodeFromConflict: getExistingCodeFromConflictMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const link: TrackedLink = {
  code: "active1",
  url: "https://example.com/active",
  clicks: 3,
  expiry: null,
  token: "token-active1",
};

describe("EditLinkDialog", () => {
  beforeEach(() => {
    updateLinkMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("prefills the destination URL, sends a PATCH with only the changed url field, and refreshes the list", async () => {
    const user = userEvent.setup();
    updateLinkMock.mockResolvedValue({
      url: "https://example.com/new",
      code: "active1",
      expiry: null,
    });
    const onUpdated = vi.fn();

    render(
      <EditLinkDialog
        link={link}
        token="token-active1"
        onUpdated={onUpdated}
        onReadOnly={vi.fn()}
        onRemoved={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));

    const urlInput = await screen.findByLabelText("Destination URL");
    expect(urlInput).toHaveValue("https://example.com/active");

    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateLinkMock).toHaveBeenCalledTimes(1));
    expect(updateLinkMock).toHaveBeenCalledWith("active1", "token-active1", {
      url: "https://example.com/new",
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Link updated");
  });

  it("choosing Never sends expiry: null without touching the url", async () => {
    const user = userEvent.setup();
    const expiringLink: TrackedLink = {
      ...link,
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    updateLinkMock.mockResolvedValue({
      url: expiringLink.url,
      code: expiringLink.code,
      expiry: null,
    });

    render(
      <EditLinkDialog
        link={expiringLink}
        token="token-active1"
        onUpdated={vi.fn()}
        onReadOnly={vi.fn()}
        onRemoved={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));
    await screen.findByLabelText("Destination URL");
    await user.click(screen.getByRole("button", { name: "Never" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateLinkMock).toHaveBeenCalledTimes(1));
    expect(updateLinkMock).toHaveBeenCalledWith("active1", "token-active1", {
      expiry: null,
    });
  });

  it("editing only the URL leaves an untouched, already-expired, non-zero-second expiry alone", async () => {
    const user = userEvent.setup();
    // Expired an hour ago, with non-zero seconds - the kind of value a
    // preset produces. The picker truncates to HH:MM, so a naive
    // value-comparison would see this as "changed" even though the user
    // never touched the expiry controls, both silently shifting it earlier
    // and (since it's already expired) wrongly blocking the future-date check.
    const expiredDate = new Date(Date.now() - 60 * 60 * 1000);
    expiredDate.setSeconds(30, 0);
    const expiredLink: TrackedLink = {
      ...link,
      expiry: expiredDate.toISOString(),
    };
    updateLinkMock.mockResolvedValue({
      url: "https://example.com/new",
      code: expiredLink.code,
      expiry: expiredLink.expiry,
    });

    render(
      <EditLinkDialog
        link={expiredLink}
        token="token-active1"
        onUpdated={vi.fn()}
        onReadOnly={vi.fn()}
        onRemoved={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));
    const urlInput = await screen.findByLabelText("Destination URL");
    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/new");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateLinkMock).toHaveBeenCalledTimes(1));
    expect(updateLinkMock).toHaveBeenCalledWith("active1", "token-active1", {
      url: "https://example.com/new",
    });
    expect(
      screen.queryByText("Expiry must be a valid date in the future")
    ).not.toBeInTheDocument();
  });

  it("on a 429 from the proxy's rate limiter, shows the friendly message and leaves the entry editable", async () => {
    const user = userEvent.setup();
    updateLinkMock.mockRejectedValue(
      new ApiError(429, "Too many requests, try again in 12 seconds.", true, {
        message: "Too many requests, try again in 12 seconds.",
      })
    );
    const onReadOnly = vi.fn();
    const onRemoved = vi.fn();

    render(
      <EditLinkDialog
        link={link}
        token="token-active1"
        onUpdated={vi.fn()}
        onReadOnly={onReadOnly}
        onRemoved={onRemoved}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));
    const urlInput = await screen.findByLabelText("Destination URL");
    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/changed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Too many requests, try again in 12 seconds.");
    });
    expect(onReadOnly).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    // The dialog stays open with Save still available, so the user can retry.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("on a 422 from the backend's own validation, shows its message instead of a generic fallback", async () => {
    const user = userEvent.setup();
    updateLinkMock.mockRejectedValue(
      new ApiError(422, "URL must be at most 2048 characters long", true, {
        detail: [{ msg: "URL must be at most 2048 characters long" }],
      })
    );

    render(
      <EditLinkDialog
        link={link}
        token="token-active1"
        onUpdated={vi.fn()}
        onReadOnly={vi.fn()}
        onRemoved={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit link" }));
    const urlInput = await screen.findByLabelText("Destination URL");
    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com/changed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("URL must be at most 2048 characters long")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong. Please try again.")
    ).not.toBeInTheDocument();
  });
});
