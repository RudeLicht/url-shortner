"use client";

import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  ListXIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteLink } from "@/features/links/api";
import {
  expiryTime,
  formatDateTime,
  formatRelative,
  isExpired,
} from "@/features/links/expiry";
import {
  buildShortUrl,
  markTrackedEntryReadOnly,
  removeTrackedEntry,
} from "@/features/links/utils";
import { isBackendForbidden, isBackendNotFound } from "@/lib/api/client";
import type { TrackedLink } from "@/features/links/types";
import { useNow } from "@/hooks/use-now";

type LinksTableProps = {
  links: TrackedLink[];
  /** Called both when a link is actually deleted and when a read-only entry is just removed from this browser's list. */
  onRemoved: (code: string) => void;
  /** Called when the backend rejects this browser's delete token as invalid, so the entry should render read-only from now on. */
  onReadOnly: (code: string) => void;
};

export function LinksTable({ links, onRemoved, onReadOnly }: LinksTableProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // Ticks every minute for the countdowns, and exactly when a link expires so
  // its "Expired" badge appears without a page refresh.
  const now = useNow(
    60_000,
    links.flatMap((link) => expiryTime(link.expiry) ?? [])
  );

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(buildShortUrl(code));
      setCopiedCode(code);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Short link</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead>Clicks</TableHead>
          <TableHead>Expiry</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => (
          <TableRow key={link.code}>
            <TableCell>
              <div className="flex items-center gap-2">
                <a
                  href={buildShortUrl(link.code)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  /{link.code}
                  <ExternalLinkIcon className="size-3.5" />
                </a>
                {isExpired(link.expiry, now) && (
                  <Badge variant="destructive">Expired</Badge>
                )}
                {link.token === null && (
                  <Badge
                    variant="secondary"
                    title="This browser doesn't hold a delete key for this link (it was shortened elsewhere, or before delete keys existed). You can remove it from your list."
                  >
                    Read-only
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">
              {link.url}
            </TableCell>
            <TableCell>{link.clicks}</TableCell>
            <TableCell className="text-muted-foreground">
              <ExpiryCell expiry={link.expiry} now={now} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy short link"
                  onClick={() => handleCopy(link.code)}
                >
                  {copiedCode === link.code ? <CheckIcon /> : <CopyIcon />}
                </Button>

                {link.token !== null ? (
                  <DeleteLinkAction
                    link={link}
                    token={link.token}
                    onRemoved={onRemoved}
                    onReadOnly={onReadOnly}
                  />
                ) : (
                  <RemoveFromListAction link={link} onRemoved={onRemoved} />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExpiryCell({ expiry, now }: { expiry: string | null; now: number }) {
  const time = expiryTime(expiry);
  if (time === null) return "Never";

  const date = formatDateTime(new Date(time));
  if (time <= now) return date;

  return (
    <div className="flex flex-col">
      <span>{date}</span>
      <span className="text-xs">{formatRelative(time, now)}</span>
    </div>
  );
}

type DeleteLinkActionProps = {
  link: TrackedLink;
  token: string;
  onRemoved: (code: string) => void;
  onReadOnly: (code: string) => void;
};

function DeleteLinkAction({
  link,
  token,
  onRemoved,
  onReadOnly,
}: DeleteLinkActionProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteLink(link.code, token);
      removeTrackedEntry(link.code);
      onRemoved(link.code);
      toast.success("Link deleted");
      setOpen(false);
    } catch (err) {
      // A backend 404 means the link is already gone (e.g. deleted from
      // another tab) - treat that as a successful delete rather than an
      // error. A non-JSON 404 (e.g. a proxy error page) is still a failure.
      if (isBackendNotFound(err)) {
        removeTrackedEntry(link.code);
        onRemoved(link.code);
        toast.success("Link deleted");
        setOpen(false);
      } else if (isBackendForbidden(err)) {
        // The backend has rejected this browser's token as missing/wrong (or
        // the link predates delete tokens) - it will never succeed again, so
        // downgrade the entry to read-only rather than leaving it stuck
        // showing a Delete button that always fails.
        markTrackedEntryReadOnly(link.code);
        onReadOnly(link.code);
        toast.error("You can't delete this link", {
          description:
            "It's now shown read-only in your list - you can remove it from there.",
        });
        setOpen(false);
      } else {
        // Any other failure - including a non-JSON 403, e.g. a Cloudflare
        // challenge page - is treated as transient, not an ownership
        // refusal, so the entry and dialog are left as-is.
        toast.error("Couldn't delete link, please try again");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Delete link" />
        }
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this link?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the short link{" "}
            <span className="font-medium text-foreground">
              /{link.code}
            </span>{" "}
            and its click stats. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type RemoveFromListActionProps = {
  link: TrackedLink;
  onRemoved: (code: string) => void;
};

/**
 * For read-only (not owned by this browser) links: only removes the entry
 * from this browser's local list, no API call - there's no delete token to
 * send, so the backend link itself is left untouched.
 */
function RemoveFromListAction({ link, onRemoved }: RemoveFromListActionProps) {
  const handleRemove = () => {
    removeTrackedEntry(link.code);
    onRemoved(link.code);
    toast.success("Removed from your list");
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove from list"
      title="Remove from your list (this doesn't delete the link)"
      onClick={handleRemove}
    >
      <ListXIcon />
    </Button>
  );
}
