import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const isCi = Boolean(process.env.CI);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const shouldSkipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 2 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "test-results/e2e-artifacts",
  webServer: shouldSkipWebServer
    ? undefined
    : {
        command: `node ./scripts/run-next-with-css-wasm.mjs dev --webpack --port ${port}`,
        url: baseURL,
        timeout: 180_000,
        reuseExistingServer: !isCi,
        env: {
          ...process.env,
          NEXT_TEST_WASM: "1",
          NEXT_DIST_DIR: ".next-playwright",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
