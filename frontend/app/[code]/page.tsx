import { redirect } from "next/navigation";
import { ClockIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { getLinkForRedirect } from "@/features/links/api";
import { ApiError } from "@/lib/api/client";
import { isReservedCode } from "@/lib/constants";

type CodePageProps = {
  params: Promise<{ code: string }>;
};

export default async function CodePage({ params }: CodePageProps) {
  const { code } = await params;

  let destination: string | null = null;
  let errorStatus: 404 | 410 | "unknown" | "invalid" | null = null;

  if (isReservedCode(code)) {
    // A reserved word can never be a real short code (see lib/constants.ts),
    // so skip the backend call entirely and go straight to "not found".
    errorStatus = 404;
  } else {
    try {
      const info = await getLinkForRedirect(code);
      destination = info.url;
    } catch (error) {
      // Any failure here - a 404/410 from the backend, some other API error,
      // or a plain network failure (fetch itself rejecting) - should fall
      // back to a friendly error state rather than crashing the page.
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        errorStatus = error.status;
      } else {
        errorStatus = "unknown";
      }
    }
  }

  // The backend accepts any string as the destination URL (e.g. when a
  // client POSTs directly to the API), so a scheme-less value like
  // "example.com" would otherwise become a relative redirect to
  // /example.com, and a javascript:/data: value would be passed through
  // unchecked. Only ever redirect to a parsed, absolute http(s) URL.
  let safeDestination: string | null = null;
  if (destination) {
    try {
      const parsed = new URL(destination);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        safeDestination = destination;
      } else {
        errorStatus = "invalid";
      }
    } catch {
      errorStatus = "invalid";
    }
  }

  // redirect() must be called outside the try/catch above - it works by
  // throwing internally, and we don't want to mistake that for a real error.
  if (safeDestination) {
    redirect(safeDestination);
  }

  if (errorStatus === 410) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          icon={ClockIcon}
          title="This link has expired"
          description="The short link you followed is no longer active."
        />
      </main>
    );
  }

  if (errorStatus === "invalid") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          icon={TriangleAlertIcon}
          title="Invalid destination"
          description="This short link points to an address we can't open."
        />
      </main>
    );
  }

  if (errorStatus === "unknown") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          icon={TriangleAlertIcon}
          title="Something went wrong"
          description="We couldn't resolve this link right now. Please try again in a moment."
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ErrorState
        icon={LinkIcon}
        title="Link not found"
        description="This short link doesn't exist or may have been deleted."
      />
    </main>
  );
}
