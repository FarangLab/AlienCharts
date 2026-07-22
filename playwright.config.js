import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 20_000,
  use: { baseURL: "http://127.0.0.1:4178", headless: true },
  webServer: {
    command: "npm run examples",
    port: 4178,
    reuseExistingServer: true,
  },
});
