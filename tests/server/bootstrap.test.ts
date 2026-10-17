import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLockedDependencies, isSupportedNode } from "../../app/bootstrap.mjs";

describe("server bootstrap", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ["24.21.9", false],
    ["24.22.0", true],
    ["25.0.0", true],
    ["26.9.1", true],
    ["27.0.0", false],
  ])("classifies Node %s support as %s", (version, supported) => {
    expect(isSupportedNode(version)).toBe(supported);
  });

  it("runs npm ci on a cold tree and skips it when the root lock is unchanged", () => {
    const fixture = createFixture();

    ensureLockedDependencies(fixture.options);
    ensureLockedDependencies(fixture.options);

    expect(invocations(fixture.logPath)).toEqual([[process.execPath, "ci"]]);
    expect(
      statSync(join(fixture.root, "node_modules", ".tutair-package-lock.sha256")).mode & 0o777,
    ).toBe(0o600);
  });

  it("runs npm ci again when the root lock changes despite an installed-tree lock", () => {
    const fixture = createFixture();
    ensureLockedDependencies(fixture.options);
    writeFileSync(join(fixture.root, "node_modules", ".package-lock.json"), "stale installed lock");
    writeFileSync(join(fixture.root, "package-lock.json"), '{"lockfileVersion":3,"changed":true}');

    ensureLockedDependencies(fixture.options);

    expect(invocations(fixture.logPath)).toEqual([
      [process.execPath, "ci"],
      [process.execPath, "ci"],
    ]);
  });

  it("repairs permissions on an existing matching lock marker", () => {
    const fixture = createFixture();
    const markerPath = join(fixture.root, "node_modules", ".tutair-package-lock.sha256");
    ensureLockedDependencies(fixture.options);
    chmodSync(markerPath, 0o644);

    ensureLockedDependencies(fixture.options);

    expect(invocations(fixture.logPath)).toEqual([[process.execPath, "ci"]]);
    expect(statSync(markerPath).mode & 0o777).toBe(0o600);
  });

  it("replaces a symlinked lock marker without changing its target", () => {
    const fixture = createFixture();
    const markerPath = join(fixture.root, "node_modules", ".tutair-package-lock.sha256");
    const targetPath = join(fixture.root, "marker-target");
    ensureLockedDependencies(fixture.options);
    const digest = readFileSync(markerPath, "utf8");
    rmSync(markerPath);
    writeFileSync(targetPath, digest);
    symlinkSync(targetPath, markerPath);

    ensureLockedDependencies(fixture.options);

    expect(invocations(fixture.logPath)).toEqual([
      [process.execPath, "ci"],
      [process.execPath, "ci"],
    ]);
    expect(readFileSync(targetPath, "utf8")).toBe(digest);
    expect(statSync(markerPath).isFile()).toBe(true);
  });

  it("does not write the lock marker when npm ci fails", () => {
    const fixture = createFixture(17);

    expect(() => ensureLockedDependencies(fixture.options)).toThrow(
      "Bootstrap command exited with status 17",
    );
    expect(existsSync(join(fixture.root, "node_modules", ".tutair-package-lock.sha256"))).toBe(
      false,
    );
  });

  function createFixture(exitCode = 0) {
    const root = mkdtempSync(join(tmpdir(), "tutair-bootstrap-"));
    directories.push(root);
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
    const logPath = join(root, "npm-invocations.jsonl");
    const npmCli = join(root, "fake-npm.mjs");
    writeFileSync(
      npmCli,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(logPath)}, JSON.stringify([process.execPath, ...process.argv.slice(2)]) + "\\n"); process.exit(${exitCode});`,
    );
    return {
      root,
      logPath,
      options: { root, execPath: process.execPath, npmCli, stdio: "pipe" as const },
    };
  }
});

function invocations(path: string): readonly (readonly string[])[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
