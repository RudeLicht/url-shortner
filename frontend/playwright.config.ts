import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const BACKEND_PORT = 8123;
const FRONTEND_PORT = 3100;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

const backendDir = path.resolve(__dirname, "..", "backend");

// A disposable sqlite file outside the repo, at a fixed path reused across
// Playwright runs, so the e2e suite never touches the real Postgres database
// configured in backend/.env and each run starts from an empty schema (the
// backend webServer's `tests.e2e_init_db` deletes this file before
// recreating the schema).
const e2eDbPath = path
  .join(os.tmpdir(), "url-shortener-e2e.db")
  .replace(/\\/g, "/");
const databaseUrl = `sqlite:///${e2eDbPath}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Recreates the schema, then serves the API against it.
      command: `uv run python -m tests.e2e_init_db && uv run uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: backendDir,
      url: `${BACKEND_URL}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL: databaseUrl,
        ORIGIN: FRONTEND_URL,
        ENVIRONMENT: "development",
      },
    },
    {
      // `next dev` refuses to run a second instance in the same project
      // directory (even on a different port) if one is already running -
      // use a production build+start instead, which also better matches how
      // the app is actually deployed.
      command: `npm run build && npm run start -- --port ${FRONTEND_PORT}`,
      cwd: __dirname,
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_BACKEND_URL: BACKEND_URL,
        // Build/serve into a separate output dir so this e2e-only build
        // (baked with the throwaway backend URL above) never overwrites a
        // developer's real `.next` build - see next.config.ts.
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
