import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { canonicalPost, createBackendHarness, makeClient, post } from "./backend-harness.js";

const exposureRecord = z.object({
  id: z.string(),
  learner_id: z.string(),
  knowledge_id: z.string(),
  revision: z.number(),
  message_id: z.string(),
  created_at: z.string(),
});

describe("exposure immutability and privacy", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  async function exposedSession() {
    const context = harness.setup();
    await context.client.call("/api/auth/local-signup", post({}));
    const created = z
      .object({ conversation: z.object({ id: z.string() }) })
      .parse(await context.client.json("/api/conversations", post({})));
    const result = await context.client.call(
      `/api/conversations/${created.conversation.id}/tutor-turn`,
      post({ content: "Explain the claim" }),
    );
    expect(result.status).toBe(201);
    const exposure = exposureRecord.parse(
      context.database.one("SELECT * FROM exposures", [], exposureRecord),
    );
    return { ...context, exposure };
  }

  it.each(["UPDATE exposures SET revision=99", "DELETE FROM exposures"])(
    "blocks ordinary history mutation: %s",
    async (sql) => {
      // Given
      const { database } = await exposedSession();
      // When / Then
      expect(() => database.run(sql)).toThrow("exposures are immutable");
    },
  );

  it.each([
    "revision",
    "learner-message",
    "foreign-message",
    "foreign-revision",
    "mismatched-event",
  ] as const)(
    "rejects inconsistent %s provenance without attaching exposure to another source",
    async (mismatch) => {
      // Given
      const { database, app, client, exposure } = await exposedSession();
      const foreign = mismatch === "foreign-message" || mismatch === "foreign-revision";
      const sourceClient = foreign ? makeClient(app) : client;
      if (foreign) await sourceClient.call("/api/auth/local-signup", post({}));
      const conversation = z
        .object({ conversation: z.object({ id: z.string() }) })
        .parse(await sourceClient.json("/api/conversations", post({})));
      const source =
        mismatch === "learner-message"
          ? (
              await sourceClient.json(
                `/api/conversations/${conversation.conversation.id}/messages`,
                post({ content: "Learner message" }),
              )
            ).message
          : (
              await sourceClient.json(
                `/api/conversations/${conversation.conversation.id}/tutor-turn`,
                post({ content: "Explain the claim" }),
              )
            ).tutorMessage;
      const sourceId = z.object({ id: z.string() }).parse(source).id;
      const knowledgeId =
        mismatch === "foreign-revision"
          ? z
              .object({ item: z.object({ id: z.string() }) })
              .parse(
                await sourceClient.json(
                  "/api/knowledge",
                  post({ title: "Private", statement: "Private definition" }),
                ),
              ).item.id
          : exposure.knowledge_id;
      const revisionId = z
        .object({ id: z.string() })
        .parse(
          database.one(
            "SELECT id FROM knowledge_revisions WHERE knowledge_id=? AND revision=1",
            [knowledgeId],
            z.object({ id: z.string() }),
          ),
        ).id;
      const useOriginalMessage = mismatch === "revision" || mismatch === "foreign-revision";
      const messageId =
        useOriginalMessage || mismatch === "mismatched-event" ? exposure.message_id : sourceId;
      const eventId = z
        .object({ id: z.string() })
        .parse(
          database.one(
            "SELECT id FROM message_events WHERE message_id=? AND event_type='created'",
            [useOriginalMessage ? exposure.message_id : sourceId],
            z.object({ id: z.string() }),
          ),
        ).id;
      // When / Then
      expect(() =>
        database.run(
          "INSERT INTO exposures(id,learner_id,knowledge_id,revision,message_id,created_at,knowledge_revision_id,message_event_id,provenance) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            crypto.randomUUID(),
            exposure.learner_id,
            knowledgeId,
            mismatch === "revision" ? 2 : 1,
            messageId,
            exposure.created_at,
            revisionId,
            eventId,
            "generation_snapshot",
          ],
        ),
      ).toThrow("invalid exposure provenance");
    },
  );

  it("rejects replacement writes that would overwrite an immutable exposure", async () => {
    const { database } = await exposedSession();
    expect(() =>
      database.run(
        "INSERT OR REPLACE INTO exposures SELECT id,learner_id,knowledge_id,revision,message_id,'2099-01-01T00:00:00.000Z',knowledge_revision_id,message_event_id,provenance FROM exposures",
      ),
    ).toThrow("invalid exposure provenance");
  });

  it("erases both private and canonical exposures while retaining canonical definitions and another learner", async () => {
    // Given
    const { database, app, client, exposure } = await exposedSession();
    const imported = z
      .object({
        imported: z.array(
          z.object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) }),
        ),
      })
      .parse(
        await client.json(
          "/api/knowledge/import",
          canonicalPost({
            format: "yaml",
            content:
              "source: test\nitems:\n  - key: fsm\n    title: FSM\n    statement: Finite states\n",
          }),
        ),
      );
    const canonical = z
      .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
      .parse(imported.imported[0]);
    const eventId = z
      .object({ id: z.string() })
      .parse(
        database.one(
          "SELECT id FROM message_events WHERE message_id=? AND event_type='created'",
          [exposure.message_id],
          z.object({ id: z.string() }),
        ),
      ).id;
    database.run(
      "INSERT INTO exposures(id,learner_id,knowledge_id,revision,message_id,created_at,knowledge_revision_id,message_event_id,provenance) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        exposure.learner_id,
        canonical.item.id,
        1,
        exposure.message_id,
        exposure.created_at,
        canonical.revision.id,
        eventId,
        "generation_snapshot",
      ],
    );
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));
    await other.call("/api/conversations", post({ title: "Keep" }));
    const exported = await client.json("/api/export");
    expect(
      z
        .array(
          z.object({
            knowledgeRevisionId: z.string(),
            messageEventId: z.string(),
            provenance: z.literal("generation_snapshot"),
          }),
        )
        .parse(exported.exposures),
    ).toHaveLength(2);

    // When
    const response = await client.call("/api/privacy", { method: "DELETE" });

    // Then
    expect(response.status).toBe(204);
    expect((await client.call("/api/session")).status).toBe(401);
    expect(
      database.all(
        "SELECT * FROM exposures WHERE learner_id=?",
        [exposure.learner_id],
        exposureRecord,
      ),
    ).toEqual([]);
    expect((await other.json(`/api/knowledge/${canonical.item.id}`)).revisions).toHaveLength(1);
    expect((await other.json("/api/conversations")).conversations).toHaveLength(1);
    expect(database.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database.one("SELECT active FROM privacy_mode", [], z.object({ active: z.number() })),
    ).toEqual({ active: 0 });
  });
});
