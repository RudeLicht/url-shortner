import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Playwright e2e suite build/start into a separate output
  // directory (see frontend/playwright.config.ts) so it never overwrites a
  // developer's regular `.next` build. Unset (the default) behaves exactly
  // like plain Next.js.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
