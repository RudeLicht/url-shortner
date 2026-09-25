"use client";

import { useCallback, useEffect, useState } from "react";
import { LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Loading } from "@/components/shared/loading";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ShortenForm } from "@/features/links/components/shorten-form";
import { LinksTable } from "@/features/links/components/links-table";
import { getLinkStats } from "@/features/links/api";
import { getTrackedCodes, removeTrackedCode } from "@/features/links/utils";
import { isBackendNotFound } from "@/lib/api/client";
import type { TrackedLink } from "@/features/links/types";

type FetchLinksResult = {
  links: TrackedLink[];
  /** True when at least one tracked code failed to load for a reason other than a 404. */
  hadPartialFailure: boolean;
};

export default function HomePage() {
  const [links, setLinks] = useState<TrackedLink[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [hasPartialFailure, setHasPartialFailure] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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

  useEffect(() => {
    let ignore = false;

    fetchLinksData()
      .then(({ links, hadPartialFailure }) => {
        if (!ignore) {
          setLinks(links);
          setHasPartialFailure(hadPartialFailure);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!ignore) {
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
  }, [fetchLinksData, reloadToken]);

  const refreshLinks = useCallback(() => {
    setStatus("loading");
    setReloadToken((token) => token + 1);
  }, []);

  const handleDeleted = (code: string) => {
    setLinks((current) => current.filter((link) => link.code !== code));
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-20 sm:py-28">
      <section className="flex flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <LinkIcon className="size-4" />
          Shorten
        </div>

        <h1 className="text-balance font-heading text-4xl font-medium tracking-tight sm:text-6xl">
          Shorten your links.
          <br />
          Keep it simple.
        </h1>

        <p className="max-w-md text-balance text-muted-foreground">
          Paste a long URL, get a short one back. No account needed.
        </p>

        <div className="w-full max-w-xl">
          <ShortenForm onCreated={refreshLinks} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-medium">Your links</h2>

        {status === "loading" && <Loading label="Loading your links..." />}

        {status === "error" && (
          <ErrorState
            title="Couldn't load your links"
            description="Something went wrong while fetching your links. Please try again."
            action={
              <Button variant="outline" onClick={refreshLinks}>
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
