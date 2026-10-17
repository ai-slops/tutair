import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import { Database } from "../../src/server/database.js";
import { DisabledProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { TurnRequestStore } from "../../src/server/turn-request-store.js";
import type { LearnerId } from "../../src/server/types.js";

const idRow = z.object({ id: z.string() });
const recoveredRow = z.object({
  state: z.string(),
  runtime_phase: z.string().nullable(),
  runtime_effect: z.string().nullable(),
  error_code: z.string().nullable(),
});

describe("runtime persistence recovery", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("marks interrupted turns effect-unknown and never reopens their terminal state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tutair-recovery-"));
    directories.push(directory);
    const databasePath = join(directory, "tutair.sqlite");
    const database = new Database(databasePath);
    const core = new CoreRepository(database);
    const signup = core.signup("Recovery learner");
    const learner = idRow.parse(signup.learner);
    const owner: LearnerId = learner.id;
    const conversation = idRow.parse(core.createConversation(owner, "Recovery", null));
    const message = idRow.parse(core.createMessage(owner, conversation.id, "learner", "saved"));
    const store = new TurnRequestStore(database);
    store.create({
      owner,
      conversationId: conversation.id,
      requestId: "request-recovery",
      userMessageId: message.id,
      baseHash: "base",
    });
    store.attachRuntime({
      owner,
      conversationId: conversation.id,
      requestId: "request-recovery",
      operationId: crypto.randomUUID(),
    });
    database.close();

    const restarted = createApp({ databasePath, provider: new DisabledProvider() });
    await restarted.ready;
    const recovered = recoveredRow.parse(
      restarted.database.raw
        .prepare(
          "SELECT state,runtime_phase,runtime_effect,error_code FROM tutor_turn_requests WHERE request_id=?",
        )
        .get("request-recovery"),
    );
    expect(recovered).toEqual({
      state: "failed",
      runtime_phase: "abandoned",
      runtime_effect: "unknown",
      error_code: "runtime_effect_unknown",
    });

    new TurnRequestStore(restarted.database).complete({
      owner,
      conversationId: conversation.id,
      requestId: "request-recovery",
      response: { late: true },
      tutorMessageId: message.id,
      run: null,
    });
    expect(
      recoveredRow.parse(
        restarted.database.raw
          .prepare(
            "SELECT state,runtime_phase,runtime_effect,error_code FROM tutor_turn_requests WHERE request_id=?",
          )
          .get("request-recovery"),
      ).state,
    ).toBe("failed");
    await restarted.runtime.dispose();
    restarted.database.close();
  });
});
