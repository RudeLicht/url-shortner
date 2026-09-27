export type ShortenUrlRequest = {
  url: string;
  /** ISO 8601 datetime string; omit for no expiry. */
  expiry?: string;
};

export type ShortenUrlResponse = {
  url: string;
  /** This is the short code, not a full URL. */
  short_url: string;
  expiry: string | null;
  /**
   * Secret delete token, returned only once at creation. Typed as always
   * present, but the frontend and backend deploy independently - an older
   * backend predating delete tokens could omit it, so callers must guard
   * at runtime rather than trusting this type alone.
   */
  delete_token: string;
};

export type LinkStats = {
  url: string;
  clicks: number;
  expiry: string | null;
};

export type LinkRedirectInfo = {
  url: string;
  code: string;
  expiry: string | null;
};

/**
 * A code this browser knows about, alongside its delete token if this
 * browser is the one that created it. `token` is `null` for links tracked
 * read-only - e.g. a legacy entry from before delete tokens existed, or a
 * link someone else shortened that this browser merely bumped into via a
 * 409 conflict.
 */
export type TrackedEntry = {
  code: string;
  token: string | null;
};

/** A tracked link merges the locally-known entry with its fetched stats. */
export type TrackedLink = LinkStats &
  TrackedEntry;
