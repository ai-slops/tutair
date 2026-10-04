import { createServer } from "node:net";
import { defineConfig } from "@playwright/test";

async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a browser-test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const port =
  process.env["TUTOR_E2E_PORT"] === undefined
    ? await availablePort()
    : Number(process.env["TUTOR_E2E_PORT"]);
process.env["TUTOR_E2E_PORT"] = String(port);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL,
    channel: "chrome",
    launchOptions: { args: ["--no-sandbox"] },
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/server.mjs",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: { TUTOR_E2E_SERVER: "1", TUTOR_E2E_PORT: String(port) },
  },
});
