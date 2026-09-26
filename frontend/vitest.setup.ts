import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  // Server-side tests opt into the node environment, which has no window.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
