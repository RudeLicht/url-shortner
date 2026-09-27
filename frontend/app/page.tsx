"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LinkIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Loading } from "@/components/shared/loading";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ShortenForm } from "@/features/links/components/shorten-form";
import { LinksTable } from "@/features/links/components/links-table";
import { getLinkStats } from "@/features/links/api";
import { getTrackedCodes, removeTrackedCode } from "@/features/links/utils";
import { isBackendNotFound } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { TrackedLink } from "@/features/links/types";

type FetchLinksResult = {
  links: TrackedLink[];
  /** True when at least one tracked code failed to load for a reason other than a 404. */
  hadPartialFailure: boolean;
};

/**
 * - `initial`: first load; a failure shows the full-page error.
 * - `retry`: the error state's Retry button; shows the loading state again.
 * - `manual`: the Refresh button; keeps the table up and toasts on failure.
 * - `background`: tab refocus / periodic poll; keeps the table up, fails silently.
 */
type LoadMode = "initial" | "retry" | "manual" | "background";

// With the DB on the same VPS each poll is cheap; this mostly keeps click
// counts fresh while the tab is open.
const AUTO_REFRESH_MS = 30_000;

export default function HomePage() {
  const [links, setLinks] = useState<TrackedLink[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [hasPartialFailure, setHasPartialFailure] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Only the most recently started load may update state, so a slow earlier
  // response can't overwrite a newer one.
  const latestRequestRef = useRef(0);

  // Pure data fetch - intentionally contains no setState calls itself, so
  // that the effect below can call it directly and only update state from
  // within the .then()/.catch() callbacks (the pattern React's own docs use
  // for data fetching in effects).
  const fetchLinksData = useCallback(async (): Promise<FetchLinksResult> => {
    const codes = getTrackedCodes();

    const settled = await Promise.allSettled(
      codes.map(async (code) => {
        const stats = await getLinkStats(code);
        return { code, ...stats };
      })
    );

    const links: TrackedLink[] = [];
    let hadPartialFailure = false;

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        links.push(result.value);
        return;
      }

      const error = result.reason;
      if (isBackendNotFound(error)) {
        removeTrackedCode(codes[index]);
        return;
      }

      hadPartialFailure = true;
    });

    // Only surface the full-page error state when every single fetch
    // failed (and none of those failures were just stale 404s) - a
    // handful of bad codes shouldn't hide the links that loaded fine.
    if (codes.length > 0 && links.length === 0 && hadPartialFailure) {
      throw new Error("Failed to load any links");
    }

    return { links, hadPartialFailure };
  }, []);

  // Only sets state from within the promise callbacks, so it's safe to call
  // straight from an effect.
  const trackLoad = useCallback(
    (mode: LoadMode) => {
      const requestId = ++latestRequestRef.current;
      const isLatest = () => requestId === latestRequestRef.current;

      fetchLinksData()
        .then(({ links, hadPartialFailure }) => {
          if (!isLatest()) return;
          setLinks(links);
          setHasPartialFailure(hadPartialFailure);
          setStatus("ready");
        })
        .catch(() => {
          if (!isLatest()) return;
          if (mode === "initial" || mode === "retry") {
            setStatus("error");
          } else if (mode === "manual") {
            toast.error("Couldn't refresh your links");
          }
        })
        .finally(() => {
          if (isLatest()) setIsRefreshing(false);
        });
    },
    [fetchLinksData]
  );

  useEffect(() => {
    trackLoad("initial");
  }, [trackLoad]);

  const refreshLinks = useCallback(
    (mode: Exclude<LoadMode, "initial">) => {
      if (mode === "retry") setStatus("loading");
      if (mode === "manual") setIsRefreshing(true);
      trackLoad(mode);
    },
    [trackLoad]
  );

  // Quietly refetch when the user comes back to the tab, and periodically
  // while it's visible, so click counts and expiries stay current.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refreshLinks("background");
    };

    const id = window.setInterval(refreshIfVisible, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshLinks]);

  const handleDeleted = (code: string) => {
    setLinks((current) => current.filter((link) => link.code !== code));
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-20 sm:py-28">
      <section className="flex flex-col items-center gap-8 text-center">

        <h1 className="text-balance font-heading text-4xl font-medium tracking-tight sm:text-6xl">
          Shorten your links.
          <br />
          Keep it simple.
        </h1>

        <p className="max-w-md text-balance text-muted-foreground">
          Paste a long URL, get a short one back. No account needed.
        </p>

        <div className="w-full max-w-xl">
          <ShortenForm onCreated={() => refreshLinks("manual")} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg font-medium">Your links</h2>
          {status === "ready" && links.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isRefreshing}
              onClick={() => refreshLinks("manual")}
            >
              <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
          )}
        </div>

        {status === "loading" && <Loading label="Loading your links..." />}

        {status === "error" && (
          <ErrorState
            title="Couldn't load your links"
            description="Something went wrong while fetching your links. Please try again."
            action={
              <Button variant="outline" onClick={() => refreshLinks("retry")}>
                Retry
              </Button>
            }
          />
        )}

        {status === "ready" && links.length === 0 && (
          <EmptyState
            icon={LinkIcon}
            title="No links yet"
            description="Shorten your first link above to see it here."
          />
        )}

        {status === "ready" && links.length > 0 && (
          <>
            {hasPartialFailure && (
              <p className="text-sm text-muted-foreground">
                Some of your links couldn&apos;t be loaded. They&apos;re
                hidden for now - try refreshing in a moment.
              </p>
            )}
            <LinksTable links={links} onDeleted={handleDeleted} />
          </>
        )}
      </section>
    </main>
  );
}
