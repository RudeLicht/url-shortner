import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  MAX_BUCKETS,
  rateLimitBucketCountForTests,
  resetRateLimitState,
} from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitState();
  });

  it("allows up to the limit, then blocks with a sensible retry-after", () => {
    const now = 1_000_000;

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("create", "1.2.3.4", 5, now)).toEqual({ allowed: true });
    }

    const blocked = checkRateLimit("create", "1.2.3.4", 5, now);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("resets once a new 60s window begins", () => {
    const start = 1_000_000;
    for (let i = 0; i < 5; i++) {
      checkRateLimit("create", "1.2.3.4", 5, start);
    }
    expect(checkRateLimit("create", "1.2.3.4", 5, start).allowed).toBe(false);

    // Just past the window boundary - a fresh bucket should be allowed again.
    expect(checkRateLimit("create", "1.2.3.4", 5, start + 60_001).allowed).toBe(true);
  });

  it("tracks separate buckets per IP and per limit kind", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      checkRateLimit("create", "1.2.3.4", 5, now);
    }

    expect(checkRateLimit("create", "1.2.3.4", 5, now).allowed).toBe(false);
    // A different IP, same kind, is unaffected.
    expect(checkRateLimit("create", "5.6.7.8", 5, now).allowed).toBe(true);
    // Same IP, a different kind, is unaffected.
    expect(checkRateLimit("modify", "1.2.3.4", 5, now).allowed).toBe(true);
  });

  it("prunes expired buckets instead of growing memory forever", () => {
    const start = 1_000_000;
    for (let i = 0; i < 2000; i++) {
      checkRateLimit("create", `ip-${i}`, 5, start);
    }
    expect(rateLimitBucketCountForTests()).toBeGreaterThanOrEqual(2000);

    // Long after every one of those buckets' windows has expired - the next
    // call should sweep them out rather than leaving them around forever.
    checkRateLimit("create", "trigger", 5, start + 10 * 60_000);

    expect(rateLimitBucketCountForTests()).toBeLessThan(2000);
  });

  it("caps the number of buckets at MAX_BUCKETS by evicting the oldest, even under a flood of distinct keys", () => {
    const start = 1_000_000;

    for (let i = 0; i < MAX_BUCKETS + 500; i++) {
      // Each call is within its own never-expiring window, and far enough
      // apart that time-based pruning never kicks in - only the hard cap
      // should keep the map bounded.
      checkRateLimit("create", `flood-ip-${i}`, 5, start);
    }

    expect(rateLimitBucketCountForTests()).toBeLessThanOrEqual(MAX_BUCKETS);
  });
});
