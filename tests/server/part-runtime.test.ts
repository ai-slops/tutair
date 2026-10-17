import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PartRuntime } from "../../src/server/part-runtime.js";

describe("PART operation runtime", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("manages a turn and attached stage with durable UUID identifiers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tutair-part-"));
    directories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const runtime = new PartRuntime(path);
    await runtime.ready;
    let stageId = "";

    const turn = await runtime.turn({
      owner: "learner-1",
      requestId: "request-1",
      deadlineMs: 1_000,
      body: (context) =>
        runtime.stage({
          parent: context,
          kind: "tutair/stage",
          onStarted: (id) => {
            stageId = id;
          },
          body: async () => "value",
        }),
    });

    expect(turn.value).toBe("value");
    expect(turn.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await runtime.dispose();
  });

  it("classifies unsettled provider effects without replaying them", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tutair-part-recovery-"));
    directories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const first = new PartRuntime(path);
    await first.ready;
    await first.recordUnsettledFixture();
    await first.dispose();

    const second = new PartRuntime(path);
    const report = await second.ready;

    expect(report.abandoned).toHaveLength(1);
    expect(report.reconciliationRequired).toHaveLength(1);
    await second.dispose();
  });

  it("does not persist private operation payloads or credentials in the sidecar", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tutair-part-private-"));
    directories.push(directory);
    const path = join(directory, "runtime.sqlite");
    const runtime = new PartRuntime(path);
    await runtime.ready;
    const privatePayload = "private learner payload";
    const credential = "Bearer sidecar-secret";

    await runtime.turn({
      owner: "learner-private",
      requestId: "request-private",
      deadlineMs: 1_000,
      body: async () => ({ privatePayload, credential }),
    });
    await runtime.recordUnsettledFixture();
    await runtime.dispose();

    const bytes = readFileSync(path).toString("latin1");
    expect(bytes).not.toContain(privatePayload);
    expect(bytes).not.toContain(credential);
  });
});
