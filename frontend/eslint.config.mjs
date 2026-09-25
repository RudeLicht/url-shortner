import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // Separate build output used only by the Playwright e2e webServer (see
    // playwright.config.ts / next.config.ts) - not part of the app bundle.
    ".next-e2e/**",
    "next-env.d.ts",
    // Test suites have their own runner (Vitest/Playwright) and aren't part
    // of the app bundle - keep them out of the Next.js lint/type-check pass.
    "tests/**",
    "e2e/**",
    "playwright.config.ts",
    "vitest.config.ts",
    "vitest.setup.ts",
  ]),
]);

export default eslintConfig;
