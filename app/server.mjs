import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLockedDependencies, isSupportedNode, runNpm } from "./bootstrap.mjs";

if (!isSupportedNode(process.versions.node)) {
  const managedNode = join(homedir(), ".local", "bin", "node");
  if (process.env["TUTAIR_NODE_REEXEC"] !== "1" && existsSync(managedNode)) {
    const child = spawnSync(managedNode, process.argv.slice(1), {
      stdio: "inherit",
      env: { ...process.env, TUTAIR_NODE_REEXEC: "1" },
    });
    if (child.error) throw child.error;
    process.exit(child.status ?? 1);
  }
  throw new Error(
    `Tutair requires Node.js >=24.22.0 and <27; current runtime is ${process.versions.node}`,
  );
}

// Preserve DIM's existing entrypoint without modifying its lifecycle files.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
if (existsSync(".env")) process.loadEnvFile(".env");

ensureLockedDependencies();
runNpm(["run", "build"]);

await import("../dist/server/index.js");
