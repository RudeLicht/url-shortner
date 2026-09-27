// In-memory fixed-window rate limiter for the API proxy (app/api/[...path]/route.ts).
// The backend only ever sees this proxy's IP, so limiting has to happen here,
// keyed by the *client's* IP instead. There's a single frontend container, so
// an in-memory Map is enough - no Redis, no cross-instance coordination.

/** Applies to POST (creating a new short link). */
export const CREATE_LIMIT_PER_MINUTE = 10;
/** Applies to PATCH/PUT/DELETE (modifying or deleting an existing link). */
export const MODIFY_LIMIT_PER_MINUTE = 30;

const WINDOW_MS = 60_000;

// Buckets are swept opportunistically (never on a timer) so memory can't grow
// unbounded from one-off IPs that never come back. A sweep runs whenever
// enough time has passed since the last one, or the map has grown past this
// size - whichever comes first - rather than on every single call.
const PRUNE_CHECK_INTERVAL_MS = WINDOW_MS;
const PRUNE_SIZE_THRESHOLD = 1000;
// Once above PRUNE_SIZE_THRESHOLD, a full sweep is expensive (O(n)), so it's
// throttled to run at most this often - otherwise a flood of distinct keys
// (e.g. forged per-request IPs) would make every single call pay a full scan.
const PRUNE_SIZE_TRIGGERED_INTERVAL_MS = 5_000;
// Hard cap on the number of buckets, regardless of pruning. Once reached, the
// oldest entries (a Map iterates in insertion order) are evicted to make room
// for a new key, so memory is strictly bounded even if an attacker keeps
// sending distinct keys faster than their windows expire. Evicting only
// resets that key's counter, which is an acceptable trade-off.
export const MAX_BUCKETS = 10_000;

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const buckets = new Map<string, Bucket>();
let lastPruneAt = 0;

function pruneExpired(now: number): void {
  // Above the size threshold, sweeps are still throttled (to
  // PRUNE_SIZE_TRIGGERED_INTERVAL_MS, shorter than the normal
  // PRUNE_CHECK_INTERVAL_MS) rather than run on every call - otherwise a
  // flood of distinct keys that never fall back below the threshold would
  // make every single write pay a full O(n) scan.
  const minInterval =
    buckets.size >= PRUNE_SIZE_THRESHOLD
      ? PRUNE_SIZE_TRIGGERED_INTERVAL_MS
      : PRUNE_CHECK_INTERVAL_MS;

  if (now - lastPruneAt < minInterval) {
    return;
  }

  lastPruneAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * Evicts the oldest bucket(s) (a Map iterates in insertion order) so the map
 * never grows past MAX_BUCKETS, even if new distinct keys keep arriving
 * faster than pruning (or their windows) can clear them out. Only called
 * right before inserting a genuinely new key, so an existing key being reset
 * for a new window never triggers an eviction.
 */
function evictOldestIfAtCapacity(): void {
  while (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

/**
 * Checks and records one request against a fixed 60s window bucket, keyed by
 * `${kind}:${key}` (e.g. kind "create", key the client IP) - so different
 * limit kinds and different clients never share a bucket.
 *
 * `now` defaults to `Date.now()` but is injectable so tests are deterministic
 * without needing fake timers.
 */
export function checkRateLimit(
  kind: string,
  key: string,
  limit: number,
  now: number = Date.now()
): RateLimitResult {
  pruneExpired(now);

  const bucketKey = `${kind}:${key}`;
  const bucket = buckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    if (!bucket) {
      evictOldestIfAtCapacity();
    }
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count < limit) {
    bucket.count += 1;
    return { allowed: true };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/** Test-only: clears all buckets so tests don't leak state into each other. */
export function resetRateLimitState(): void {
  buckets.clear();
  lastPruneAt = 0;
}

/** Test-only: the number of buckets currently held, to assert pruning happened. */
export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/** Read at request time (not baked in at build time) so it can be overridden without a rebuild. */
export function getCreateLimit(): number {
  return parsePositiveInt(process.env.RATE_LIMIT_CREATE_PER_MINUTE) ?? CREATE_LIMIT_PER_MINUTE;
}

/** Read at request time (not baked in at build time) so it can be overridden without a rebuild. */
export function getModifyLimit(): number {
  return parsePositiveInt(process.env.RATE_LIMIT_MODIFY_PER_MINUTE) ?? MODIFY_LIMIT_PER_MINUTE;
}

/**
 * The site is behind Cloudflare, so `cf-connecting-ip` is the real client IP;
 * `x-forwarded-for`'s first entry is a fallback for local/dev setups without
 * Cloudflare in front. Requests with neither share a single "unknown" bucket.
 */
export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}
