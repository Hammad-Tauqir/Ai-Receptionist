import { defineConfig } from "@playwright/test";

const existingDevServer = process.env.PLAYWRIGHT_USE_EXISTING_DEV_SERVER === "1";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: existingDevServer ? "http://localhost:3000" : "http://127.0.0.1:3100", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: existingDevServer ? undefined : {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    env: {
      BETTER_AUTH_SECRET: "test-only-secret-that-is-long-enough-for-local-browser-tests",
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      OWNER_EMAIL: "owner@example.com",
      N8N_CHAT_URL: "",
      N8N_BASIC_AUTH_USERNAME: "",
      N8N_BASIC_AUTH_PASSWORD: "",
    },
    reuseExistingServer: false,
  },
});
