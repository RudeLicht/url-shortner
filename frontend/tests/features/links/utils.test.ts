import { beforeEach, describe, expect, it } from "vitest";
import {
  addTrackedEntry,
  buildShortUrl,
  getTrackedEntries,
  LEGACY_STORAGE_KEY,
  markTrackedEntryReadOnly,
  removeTrackedEntry,
  removeTrackedEntryIfUnchanged,
  STORAGE_KEY,
} from "@/features/links/utils";

describe("tracked entries storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty array when nothing has been tracked yet", () => {
    expect(getTrackedEntries()).toEqual([]);
  });

  it("adds an entry and persists it to localStorage, most-recent first", () => {
    addTrackedEntry("abc123", "token-abc");
    addTrackedEntry("def456", null);

    expect(getTrackedEntries()).toEqual([
      { code: "def456", token: null },
      { code: "abc123", token: "token-abc" },
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      { code: "def456", token: null },
      { code: "abc123", token: "token-abc" },
    ]);
  });

  it("dedupes when the same code is added twice", () => {
    addTrackedEntry("abc123", null);
    addTrackedEntry("abc123", null);

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("upgrades a read-only entry's token when re-added with one", () => {
    addTrackedEntry("abc123", null);
    addTrackedEntry("abc123", "token-abc");

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-abc" }]);
  });

  it("never downgrades an owned entry's token", () => {
    addTrackedEntry("abc123", "token-abc");
    addTrackedEntry("abc123", null);

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-abc" }]);
  });

  it("always replaces a stale token with a fresh non-null one, even when one is already stored (codes get reused)", () => {
    addTrackedEntry("abc123", "token-old");
    addTrackedEntry("abc123", "token-new");

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-new" }]);
  });

  it("treats an empty-string token as null on add, both for a new code and as a non-downgrading update", () => {
    addTrackedEntry("abc123", "");
    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);

    addTrackedEntry("def456", "token-def");
    addTrackedEntry("def456", "");
    expect(getTrackedEntries()).toEqual(
      expect.arrayContaining([{ code: "def456", token: "token-def" }])
    );
  });

  it("returns undefined from addTrackedEntry for a code that wasn't tracked yet", () => {
    expect(addTrackedEntry("abc123", "token-abc")).toBeUndefined();
  });

  it("returns the previously-stored entry from addTrackedEntry when the code was already tracked", () => {
    addTrackedEntry("abc123", "token-abc");

    expect(addTrackedEntry("abc123", null)).toEqual({
      code: "abc123",
      token: "token-abc",
    });
    expect(addTrackedEntry("abc123", "token-new")).toEqual({
      code: "abc123",
      token: "token-abc",
    });
  });

  it("marks a tracked entry read-only, dropping its token", () => {
    addTrackedEntry("abc123", "token-abc");

    markTrackedEntryReadOnly("abc123");

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("marking an untracked code read-only is a no-op", () => {
    addTrackedEntry("abc123", "token-abc");

    markTrackedEntryReadOnly("nonexistent");

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-abc" }]);
  });

  it("removes a tracked entry", () => {
    addTrackedEntry("abc123", null);
    addTrackedEntry("def456", null);

    removeTrackedEntry("abc123");

    expect(getTrackedEntries()).toEqual([{ code: "def456", token: null }]);
  });

  it("removing a code that isn't tracked is a no-op", () => {
    addTrackedEntry("abc123", null);

    removeTrackedEntry("nonexistent");

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("removeTrackedEntryIfUnchanged removes the entry when the stored token still matches the snapshot", () => {
    addTrackedEntry("abc123", "token-abc");
    addTrackedEntry("def456", null);

    removeTrackedEntryIfUnchanged({ code: "abc123", token: "token-abc" });

    expect(getTrackedEntries()).toEqual([{ code: "def456", token: null }]);
  });

  it("removeTrackedEntryIfUnchanged is a no-op when the stored token has since changed (null -> token)", () => {
    addTrackedEntry("abc123", null);
    // Re-tracked with a fresh token after the snapshot was taken.
    addTrackedEntry("abc123", "token-fresh");

    removeTrackedEntryIfUnchanged({ code: "abc123", token: null });

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-fresh" }]);
  });

  it("removeTrackedEntryIfUnchanged is a no-op when the stored token has since changed (tokenA -> tokenB)", () => {
    addTrackedEntry("abc123", "token-old");
    // Re-tracked with a different fresh token (codes get reused) after the
    // snapshot below was taken.
    addTrackedEntry("abc123", "token-new");

    removeTrackedEntryIfUnchanged({ code: "abc123", token: "token-old" });

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-new" }]);
  });

  it("removeTrackedEntryIfUnchanged is a no-op when the code isn't tracked at all", () => {
    addTrackedEntry("abc123", "token-abc");

    removeTrackedEntryIfUnchanged({ code: "nonexistent", token: "token-abc" });

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: "token-abc" }]);
  });

  it("recovers from corrupt (non-JSON) localStorage data by treating it as empty", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    expect(getTrackedEntries()).toEqual([]);
  });

  it("recovers from corrupt (non-array) localStorage data by treating it as empty", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));

    expect(getTrackedEntries()).toEqual([]);
  });

  it("accepts the legacy format (a plain array of code strings)", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["abc123", "def456"]));

    expect(getTrackedEntries()).toEqual([
      { code: "abc123", token: null },
      { code: "def456", token: null },
    ]);
  });

  it("drops malformed items: non-string codes, empty codes, and missing codes", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        "abc123",
        42,
        null,
        "",
        { code: "" },
        { code: 42 },
        { notCode: "x" },
        { code: "def456" },
      ])
    );

    expect(getTrackedEntries()).toEqual([
      { code: "abc123", token: null },
      { code: "def456", token: null },
    ]);
  });

  it("treats a token that isn't a string or null as null, without dropping the item", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ code: "abc123", token: 42 }])
    );

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("treats an empty-string token as null when parsed from storage", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ code: "abc123", token: "" }])
    );

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("parses a list mixing legacy plain-string items and current-format objects under the same key", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["legacy1", { code: "abc123", token: "token-abc" }, { code: "def456", token: null }])
    );

    expect(getTrackedEntries()).toEqual([
      { code: "legacy1", token: null },
      { code: "abc123", token: "token-abc" },
      { code: "def456", token: null },
    ]);
  });

  it("dedupes pre-existing duplicate entries from storage, preferring one with a token", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { code: "abc123", token: null },
        { code: "abc123", token: "token-abc" },
        { code: "def456", token: null },
      ])
    );

    expect(getTrackedEntries()).toEqual([
      { code: "abc123", token: "token-abc" },
      { code: "def456", token: null },
    ]);
  });
});

describe("legacy key migration and isolation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("migrates plain-string codes from the legacy key into the new key on first read", () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify(["abc123", "def456"])
    );

    expect(getTrackedEntries()).toEqual([
      { code: "abc123", token: null },
      { code: "def456", token: null },
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      { code: "abc123", token: null },
      { code: "def456", token: null },
    ]);
  });

  it("drops malformed items while migrating from the legacy key", () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify(["abc123", 42, null, "", { code: "" }, { notCode: "x" }])
    );

    expect(getTrackedEntries()).toEqual([{ code: "abc123", token: null }]);
  });

  it("leaves the legacy key untouched after migrating", () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify(["abc123", "def456"])
    );

    getTrackedEntries();

    expect(JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY)!)).toEqual([
      "abc123",
      "def456",
    ]);
  });

  it("leaves the legacy key untouched after subsequent writes (add/remove) to the new key", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(["abc123"]));

    getTrackedEntries();
    addTrackedEntry("def456", "token-def456");
    removeTrackedEntry("abc123");

    expect(JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY)!)).toEqual([
      "abc123",
    ]);
    expect(getTrackedEntries()).toEqual([{ code: "def456", token: "token-def456" }]);
  });

  it("prefers the new key over the legacy key once both exist", () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(["legacy-only"]));
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ code: "new-only", token: "token-new-only" }])
    );

    expect(getTrackedEntries()).toEqual([
      { code: "new-only", token: "token-new-only" },
    ]);
  });

  it("does not create the new key just from an empty read with no legacy data", () => {
    getTrackedEntries();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("buildShortUrl", () => {
  it("builds a full short link from the current origin and code", () => {
    expect(buildShortUrl("abc123")).toBe(`${window.location.origin}/abc123`);
  });
});
