"use client";

import { useState } from "react";
import { z } from "zod";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getExistingCodeFromConflict,
  updateLink,
} from "@/features/links/api";
import { ExpiryPicker } from "@/features/links/components/expiry-picker";
import {
  combineDateAndTime,
  expiryTime,
  resolveExpiry,
  type ExpiryPreset,
} from "@/features/links/expiry";
import { markTrackedEntryReadOnly, removeTrackedEntry } from "@/features/links/utils";
import {
  ApiError,
  getRateLimitMessage,
  isBackendForbidden,
  isBackendNotFound,
} from "@/lib/api/client";
import type { TrackedLink, UpdateLinkRequest } from "@/features/links/types";

const urlSchema = z.url({
  protocol: /^https?$/,
  error: "Enter a valid http:// or https:// URL",
});

type ExpiryState = {
  preset: ExpiryPreset;
  customDate: Date | undefined;
  customTime: string;
};

/** "Never" if the link has no expiry, otherwise "Custom" prefilled with its current date/time. */
function initialExpiryState(expiry: string | null): ExpiryState {
  const time = expiryTime(expiry);
  if (time === null) {
    return { preset: "never", customDate: undefined, customTime: "12:00" };
  }

  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return { preset: "custom", customDate: date, customTime: `${hours}:${minutes}` };
}

type EditLinkDialogProps = {
  link: TrackedLink;
  token: string;
  /** Called after a successful save, so the caller can refresh the list. */
  onUpdated: () => void;
  /** Called when the backend rejects this browser's delete token as invalid. */
  onReadOnly: (code: string) => void;
  /** Called when the backend reports the link no longer exists (mirrors delete's 404 handling). */
  onRemoved: (code: string) => void;
};

export function EditLinkDialog({
  link,
  token,
  onUpdated,
  onReadOnly,
  onRemoved,
}: EditLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [urlValue, setUrlValue] = useState(link.url);
  const [expiryState, setExpiryState] = useState<ExpiryState>(() =>
    initialExpiryState(link.expiry)
  );
  // Whether the user has interacted with any expiry control this time the
  // dialog was opened. The picker truncates the current expiry to HH:MM, so
  // comparing resolved values loses precision - an untouched preset-created
  // expiry (which almost always has non-zero seconds) would look "changed"
  // even though it isn't. Tracking intent directly avoids that.
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setUrlValue(link.url);
      setExpiryState(initialExpiryState(link.expiry));
      setExpiryTouched(false);
      setUrlError(null);
      setExpiryError(null);
      setFormError(null);
    }
    setOpen(next);
  };

  const handleSave = async () => {
    setUrlError(null);
    setExpiryError(null);
    setFormError(null);

    const trimmedUrl = urlValue.trim();
    const urlChanged = trimmedUrl !== link.url;

    if (urlChanged) {
      const result = urlSchema.safeParse(trimmedUrl);
      if (!result.success) {
        setUrlError(
          result.error.issues[0]?.message ?? "Enter a valid http:// or https:// URL"
        );
        return;
      }
    }

    let resolvedExpiry: Date | null = null;
    if (expiryTouched) {
      resolvedExpiry = resolveExpiry(
        expiryState.preset,
        combineDateAndTime(expiryState.customDate, expiryState.customTime),
        Date.now()
      );

      if (expiryState.preset === "custom") {
        if (resolvedExpiry === null || resolvedExpiry.getTime() <= Date.now()) {
          setExpiryError("Expiry must be a valid date in the future");
          return;
        }
      }
    }

    if (!urlChanged && !expiryTouched) {
      setOpen(false);
      return;
    }

    const payload: UpdateLinkRequest = {};
    if (urlChanged) payload.url = trimmedUrl;
    if (expiryTouched) payload.expiry = resolvedExpiry ? resolvedExpiry.toISOString() : null;

    setSaving(true);
    try {
      await updateLink(link.code, token, payload);
      toast.success("Link updated");
      setOpen(false);
      onUpdated();
    } catch (err) {
      const rateLimitMessage = getRateLimitMessage(err);
      if (rateLimitMessage) {
        // Transient, and says nothing about ownership - leave the entry and
        // dialog as-is so the user can just retry.
        toast.error(rateLimitMessage);
      } else if (isBackendForbidden(err)) {
        markTrackedEntryReadOnly(link.code);
        onReadOnly(link.code);
        setOpen(false);
        toast.error("You can't edit this link", {
          description:
            "It's now shown read-only in your list - you can remove it from there.",
        });
      } else if (isBackendNotFound(err)) {
        // The link is already gone (e.g. deleted from another tab) - remove
        // it from the list like the delete flow does, but this wasn't a
        // delete the user asked for, so don't claim it as one.
        removeTrackedEntry(link.code);
        onRemoved(link.code);
        setOpen(false);
        toast.error("This link no longer exists, so your changes weren't saved.");
      } else if (err instanceof ApiError && err.status === 409) {
        const conflictCode = getExistingCodeFromConflict(err);
        setUrlError(
          conflictCode
            ? `This URL is already shortened as /${conflictCode}`
            : err.message || "This URL has already been shortened"
        );
      } else if (err instanceof ApiError && err.isJson && (err.status === 400 || err.status === 422)) {
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Edit link" />}
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit link</DialogTitle>
          <DialogDescription>
            Update the destination or expiry for /{link.code}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="edit-link-url">Destination URL</Label>
            <Input
              id="edit-link-url"
              type="text"
              value={urlValue}
              aria-invalid={!!urlError}
              className="mt-1"
              onChange={(event) => {
                setUrlValue(event.target.value);
                setUrlError(null);
              }}
            />
            {urlError && (
              <p className="mt-1.5 text-sm text-destructive">{urlError}</p>
            )}
          </div>

          <ExpiryPicker
            preset={expiryState.preset}
            onPresetChange={(value) => {
              setExpiryState((current) => ({ ...current, preset: value }));
              setExpiryTouched(true);
              setExpiryError(null);
            }}
            customDate={expiryState.customDate}
            onCustomDateChange={(value) => {
              setExpiryState((current) => ({ ...current, customDate: value }));
              setExpiryTouched(true);
              setExpiryError(null);
            }}
            customTime={expiryState.customTime}
            onCustomTimeChange={(value) => {
              setExpiryState((current) => ({ ...current, customTime: value }));
              setExpiryTouched(true);
              setExpiryError(null);
            }}
            error={expiryError ?? undefined}
          />

          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="button" disabled={saving} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
