import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Preserve DIM's existing entrypoint without modifying its lifecycle files.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
if (existsSync(".env")) process.loadEnvFile(".env");

for (const args of [
  ...(existsSync("node_modules/.package-lock.json") ? [] : [["ci"]]),
  ["run", "build"],
]) {
  const result = spawnSync("npm", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import("../dist/server/index.js");
