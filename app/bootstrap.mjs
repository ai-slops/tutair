import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const markerName = ".tutair-package-lock.sha256";

export class BootstrapCommandError extends Error {
  name = "BootstrapCommandError";
  /** @param {number} status */
  constructor(status) {
    super(`Bootstrap command exited with status ${status}`);
    this.status = status;
  }
}

/** @param {string} version */
export function isSupportedNode(version) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  if (major < 24 || major >= 27) return false;
  return major > 24 || minor > 22 || (minor === 22 && patch >= 0);
}

/**
 * @param {{root?: string, execPath?: string, npmCli?: string, stdio?: import("node:child_process").StdioOptions}} options
 */
export function ensureLockedDependencies(options = {}) {
  const root = options.root ?? process.cwd();
  const lockPath = join(root, "package-lock.json");
  const modulesPath = join(root, "node_modules");
  const markerPath = join(modulesPath, markerName);
  const digest = createHash("sha256").update(readFileSync(lockPath)).digest("hex");
  if (
    existsSync(markerPath) &&
    lstatSync(markerPath).isFile() &&
    readFileSync(markerPath, "utf8").trim() === digest
  ) {
    chmodSync(markerPath, 0o600);
    return;
  }
  runNpm(["ci"], options);
  mkdirSync(modulesPath, { recursive: true });
  const temporaryMarker = `${markerPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryMarker, `${digest}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryMarker, markerPath);
  } finally {
    rmSync(temporaryMarker, { force: true });
  }
  chmodSync(markerPath, 0o600);
}

/**
 * @param {readonly string[]} args
 * @param {{root?: string, execPath?: string, npmCli?: string, stdio?: import("node:child_process").StdioOptions}} options
 */
export function runNpm(args, options = {}) {
  const execPath = options.execPath ?? process.execPath;
  const npmCli =
    options.npmCli ??
    join(dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const result = spawnSync(execPath, [npmCli, ...args], {
    cwd: options.root ?? process.cwd(),
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new BootstrapCommandError(result.status ?? 1);
}
