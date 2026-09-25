import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// A tiny local HTTP server stands in for the "destination" site, so the
// redirect assertion is a real network round trip without depending on any
// external connectivity.
function startTargetServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>E2E TARGET OK</body></html>");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/ok`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

test.describe("shorten, list, and redirect", () => {
  let targetUrl: string;
  let closeTargetServer: () => Promise<void>;

  test.beforeEach(async () => {
    ({ url: targetUrl, close: closeTargetServer } = await startTargetServer());
  });

  test.afterEach(async () => {
    await closeTargetServer();
  });

  test("shortens a URL, lists it, and following the short link redirects to the destination", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByPlaceholder("Paste a long URL...").fill(targetUrl);
    await page.getByRole("button", { name: "Shorten" }).click();

    // The inline "here's your short link" result box.
    const resultLocator = page.getByText(/^http:\/\/127\.0\.0\.1:3100\/\w+$/);
    await expect(resultLocator).toBeVisible();
    const shortUrl = (await resultLocator.textContent())!.trim();

    // The link should also now show up in the "Your links" table.
    const row = page.getByRole("row", { name: new RegExp(targetUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(row).toBeVisible();

    await page.goto(shortUrl);

    await expect(page).toHaveURL(targetUrl);
    await expect(page.getByText("E2E TARGET OK")).toBeVisible();
  });

  test("re-shortening the same URL reuses the existing short code instead of creating a duplicate", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByPlaceholder("Paste a long URL...").fill(targetUrl);
    await page.getByRole("button", { name: "Shorten" }).click();

    const resultLocator = page.getByText(/^http:\/\/127\.0\.0\.1:3100\/\w+$/);
    await expect(resultLocator).toBeVisible();
    const firstShortUrl = (await resultLocator.textContent())!.trim();

    await page.getByPlaceholder("Paste a long URL...").fill(targetUrl);
    await page.getByRole("button", { name: "Shorten" }).click();

    await expect(page.getByText("This URL already has a short link")).toBeVisible();
    await expect(resultLocator).toHaveText(firstShortUrl);

    // Only a single row for this URL should exist in the table - no duplicate.
    const escaped = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page.getByRole("row", { name: new RegExp(escaped) })).toHaveCount(1);
  });

  test("visiting an unknown short code shows a not-found error page", async ({ page }) => {
    await page.goto("/this-code-does-not-exist");

    await expect(page.getByText("Link not found")).toBeVisible();
  });
});
