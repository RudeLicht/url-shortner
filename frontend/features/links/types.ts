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

/** A tracked link merges the locally-known code with its fetched stats. */
export type TrackedLink = LinkStats & {
  code: string;
};
