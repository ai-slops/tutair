import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { migrateModelContexts } from "../../src/server/model-context-migration.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";

const snapshotRowSchema = z.object({
  context_json: z.string(),
  context_hash: z.string(),
});

const setupRun = () => {
  const db = new Database(":memory:");
  migrateModelContexts(db.raw);
  const core = new CoreRepository(db);
  const owner = z.object({ id: z.string() }).parse(core.signup("Snapshot QA").learner).id;
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(owner, "Replay", null));
  const message = z
    .object({ id: z.string() })
    .parse(core.createMessage(owner, conversation.id, "learner", "Explain it"));
  return { db, owner, conversationId: conversation.id, messageId: message.id };
};

it.each(["success", "failure"] as const)(
  "preserves the exact bounded provider request before a model %s",
  async (outcome) => {
    // Given
    const fixture = setupRun();
    let dispatched: StructuredCall | undefined;
    const provider: TutorProvider = {
      embeddingProfile: "disabled:v1",
      state: {
        provider: "demo",
        model: "snapshot-test",
        generation: true,
        synthetic: true,
        embedding: "disabled",
      },
      async call(call) {
        dispatched = call;
        if (outcome === "failure") throw new TypeError("provider unavailable");
        return { value: { accepted: true }, usage: null };
      },
    };

    try {
      // When
      const result = new ModelRunner(fixture.db, provider).stage(
        fixture.owner,
        fixture.conversationId,
        fixture.messageId,
        "planning",
        { message: "x".repeat(100_000), traceId: "trace-1" },
        z.object({ accepted: z.boolean() }),
      );
      if (outcome === "failure") await expect(result).rejects.toThrow("provider unavailable");
      else await result;

      // Then
      expect(dispatched).toBeDefined();
      const row = fixture.db.one(
        "SELECT context_json,context_hash FROM model_run_contexts",
        [],
        snapshotRowSchema,
      );
      expect(row).not.toBeNull();
      const snapshot = z
        .object({
          stage: z.literal("planning"),
          version: z.string(),
          system: z.string(),
          data: z.record(z.string(), z.unknown()),
          jsonSchema: z.record(z.string(), z.unknown()),
        })
        .parse(JSON.parse(row?.context_json ?? "null"));
      expect(snapshot).toEqual(dispatched);
      expect(snapshot.data["message"]).not.toBe("x".repeat(100_000));
      expect(row?.context_hash).toBe(
        createHash("sha256")
          .update(row?.context_json ?? "")
          .digest("hex"),
      );
    } finally {
      fixture.db.close();
    }
  },
);

it("keeps snapshots immutable except for owner privacy erasure", () => {
  // Given
  const fixture = setupRun();
  fixture.db.run("INSERT INTO model_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
    "run-1",
    fixture.owner,
    fixture.conversationId,
    "draft",
    "phase1-v1",
    "demo",
    "failed",
    fixture.messageId,
    null,
    "provider_failed",
    new Date().toISOString(),
  ]);
  fixture.db.run("INSERT INTO model_run_contexts VALUES(?,?,?,?,?,?)", [
    "run-1",
    fixture.owner,
    "model-context-v1",
    "{}",
    createHash("sha256").update("{}").digest("hex"),
    new Date().toISOString(),
  ]);

  try {
    // When / Then
    expect(() =>
      fixture.db.run("UPDATE model_run_contexts SET context_json='null' WHERE run_id='run-1'"),
    ).toThrow("model run contexts are immutable");
    expect(() => fixture.db.run("DELETE FROM model_run_contexts WHERE run_id='run-1'")).toThrow(
      "model run contexts are immutable",
    );
    expect(() =>
      fixture.db.run("INSERT OR REPLACE INTO model_run_contexts VALUES(?,?,?,?,?,?)", [
        "run-1",
        fixture.owner,
        "model-context-v1",
        "null",
        createHash("sha256").update("null").digest("hex"),
        new Date().toISOString(),
      ]),
    ).toThrow("model run contexts are immutable");
    fixture.db.run("UPDATE privacy_mode SET active=1 WHERE singleton=1");
    fixture.db.run("DELETE FROM learners WHERE id=?", [fixture.owner]);
    expect(
      fixture.db.one(
        "SELECT COUNT(*) AS count FROM model_run_contexts",
        [],
        z.object({ count: z.number() }),
      )?.count,
    ).toBe(0);
  } finally {
    fixture.db.close();
  }
});

it("does not fabricate replay snapshots for legacy model runs", () => {
  // Given
  const fixture = setupRun();
  fixture.db.run("INSERT INTO model_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
    "legacy-run",
    fixture.owner,
    fixture.conversationId,
    "evaluation",
    "phase1-v1",
    "demo",
    "completed",
    fixture.messageId,
    null,
    null,
    new Date().toISOString(),
  ]);
  fixture.db.run("INSERT INTO model_run_details VALUES(?,?,?,?,?,?,?,?,?,?)", [
    "legacy-run",
    "legacy-model",
    "evaluation",
    "phase1-prompt-v2",
    "phase1-schema-v2",
    "legacy-input-hash",
    "{}",
    null,
    1,
    "none",
  ]);

  try {
    // When
    migrateModelContexts(fixture.db.raw);

    // Then
    expect(
      fixture.db.one(
        "SELECT context_json FROM model_run_contexts WHERE run_id=?",
        ["legacy-run"],
        z.object({ context_json: z.string() }),
      ),
    ).toBeNull();
    expect(
      fixture.db.one(
        "SELECT r.version,d.schema_version FROM model_runs r JOIN model_run_details d ON d.run_id=r.id WHERE r.id=?",
        ["legacy-run"],
        z.object({ version: z.string(), schema_version: z.string() }),
      ),
    ).toEqual({ version: "phase1-v1", schema_version: "phase1-schema-v2" });
  } finally {
    fixture.db.close();
  }
});
