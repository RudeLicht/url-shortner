import { beforeEach, describe, expect, it } from "vitest";
import {
  addTrackedCode,
  buildShortUrl,
  getTrackedCodes,
  removeTrackedCode,
} from "@/features/links/utils";

const STORAGE_KEY = "url-shortener:tracked-codes";

describe("tracked codes storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty array when nothing has been tracked yet", () => {
    expect(getTrackedCodes()).toEqual([]);
  });

  it("adds a code and persists it to localStorage, most-recent first", () => {
    addTrackedCode("abc123");
    addTrackedCode("def456");

    expect(getTrackedCodes()).toEqual(["def456", "abc123"]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      "def456",
      "abc123",
    ]);
  });

  it("dedupes when the same code is added twice", () => {
    addTrackedCode("abc123");
    addTrackedCode("abc123");

    expect(getTrackedCodes()).toEqual(["abc123"]);
  });

  it("removes a tracked code", () => {
    addTrackedCode("abc123");
    addTrackedCode("def456");

    removeTrackedCode("abc123");

    expect(getTrackedCodes()).toEqual(["def456"]);
  });

  it("removing a code that isn't tracked is a no-op", () => {
    addTrackedCode("abc123");

    removeTrackedCode("nonexistent");

    expect(getTrackedCodes()).toEqual(["abc123"]);
  });

  it("recovers from corrupt (non-JSON) localStorage data by treating it as empty", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    expect(getTrackedCodes()).toEqual([]);
  });

  it("recovers from corrupt (non-array) localStorage data by treating it as empty", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));

    expect(getTrackedCodes()).toEqual([]);
  });

  it("filters out non-string entries from stored data", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["abc123", 42, null, "def456"]));

    expect(getTrackedCodes()).toEqual(["abc123", "def456"]);
  });

  it("dedupes pre-existing duplicate entries from storage", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["abc123", "abc123", "def456"]));

    expect(getTrackedCodes()).toEqual(["abc123", "def456"]);
  });
});

describe("buildShortUrl", () => {
  it("builds a full short link from the current origin and code", () => {
    expect(buildShortUrl("abc123")).toBe(`${window.location.origin}/abc123`);
  });
});
