import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const minimumNode = [24, 22, 0];
const currentNode = process.versions.node.split(".").map(Number);
const supported = minimumNode.every(
  (part, index) =>
    (currentNode[index] ?? 0) >= part ||
    minimumNode.slice(0, index).some((prior, priorIndex) => currentNode[priorIndex] > prior),
);
if (!supported) {
  const managedNode = join(homedir(), ".local", "bin", "node");
  if (process.env["TUTAIR_NODE_REEXEC"] !== "1" && existsSync(managedNode)) {
    const child = spawnSync(managedNode, process.argv.slice(1), {
      stdio: "inherit",
      env: { ...process.env, TUTAIR_NODE_REEXEC: "1" },
    });
    if (child.error) throw child.error;
    process.exit(child.status ?? 1);
  }
  throw new Error(`Tutair requires Node.js >=24.22.0; current runtime is ${process.versions.node}`);
}

// Preserve DIM's existing entrypoint without modifying its lifecycle files.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
if (existsSync(".env")) process.loadEnvFile(".env");

for (const args of [
  ...(existsSync("node_modules/.package-lock.json") ? [] : [["ci"]]),
  ["run", "build"],
]) {
  const npmCli = join(
    dirname(process.execPath),
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const result = spawnSync(process.execPath, [npmCli, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import("../dist/server/index.js");
