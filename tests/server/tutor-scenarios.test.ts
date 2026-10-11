import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider } from "../../src/server/provider.js";
import { createBackendHarness, type Json, post } from "./backend-harness.js";

const demo = () =>
  createProvider({
    TUTOR_PROVIDER: "demo",
    TUTOR_EMBEDDING_PROVIDER: "disabled",
  });

describe("phase-one tutor acceptance scenarios", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  async function session() {
    const { client } = harness.setup(demo());
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/conversations",
      post({ title: "FSM", goal: "Model a door controller with an FSM" }),
    );
    return { client, id: (created.conversation as Json).id };
  }

  it("projects FSM recognition exposure after the first explanation without learner evidence", async () => {
    const { client, id } = await session();
    await client.call(`/api/conversations/${id}/tutor-turn`, post({ content: "What is an FSM?" }));
    const result = z
      .object({
        items: z.array(z.object({ id: z.string(), title: z.string() })),
      })
      .parse(await client.json("/api/knowledge"));
    const machine = result.items.find((item) => item.title === "finite-state machine");
    expect(machine).toBeDefined();
    const detail = z
      .object({
        exposures: z.array(z.unknown()),
        evidence: z.array(z.unknown()),
        learnerState: z.array(
          z.object({ dimension: z.string(), status: z.string(), effectiveEvidence: z.number() }),
        ),
      })
      .parse(await client.json(`/api/knowledge/${machine?.id}`));
    expect(detail.exposures.length).toBeGreaterThan(0);
    expect(detail.evidence).toEqual([]);
    expect(detail.learnerState.find((item) => item.dimension === "recognition")?.status).toBe(
      "exposed",
    );
    expect(
      detail.learnerState.find((item) => item.dimension === "explanation")?.effectiveEvidence,
    ).toBe(0);
  });

  it("keeps technical and ceremonial senses separate", async () => {
    const { client, id } = await session();
    await client.call(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "What does formal mean in an FSM?" }),
    );
    const exported = await client.json("/api/export");
    const formal = (exported["knowledge"] as Json[]).filter((item) => item["title"] === "formal");
    const formalIds = new Set(formal.map((item) => item["id"]));
    const scopes = (exported.revisions as Json[])
      .filter((revision) => formalIds.has(revision["knowledgeId"]))
      .map((revision) => revision["semanticScope"]);
    expect(formal).toHaveLength(2);
    expect(scopes).toEqual(
      expect.arrayContaining(["technical specification", "ceremony and etiquette"]),
    );
  });

  it("scaffolds central unknowns without diagnosing peripheral terms", async () => {
    const { client, id } = await session();
    await client.call(`/api/conversations/${id}/tutor-turn`, post({ content: "Show me an FSM." }));
    const details = (await client.json("/api/export"))["modelRunDetails"] as Json[];
    const lint = details.find((detail) => detail["purpose"] === "lint");
    const output = lint?.["output"] as Json;
    const concepts = output["concepts"] as Json[];
    expect(concepts.find((concept) => concept["concept"] === "state")?.["action"]).toBe(
      "define_inline",
    );
    expect(
      concepts.find((concept) => concept["concept"] === "ceremonial formality")?.["action"],
    ).toBe("allow");
  });

  it("discounts a copied tutor answer deterministically", async () => {
    const { client, id } = await session();
    const first = await client.json(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "Explain an FSM." }),
    );
    expect(first["error"]).toBeUndefined();
    const copied = String((first.tutorMessage as Json)["content"]);
    const second = await client.json(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: copied }),
    );
    expect(second["error"]).toBeUndefined();
    const exported = await client.json("/api/export");
    const evidence = exported["evidence"] as Json[];
    expect(
      (exported["modelRunDetails"] as Json[]).filter((row) => row["purpose"] === "evaluation"),
    ).toHaveLength(2);
    expect(evidence.at(-1)?.["copiedFromRecentContext"]).toBe(1);
    expect(Number(evidence.at(-1)?.["weight"])).toBeLessThan(0.1);
  }, 10_000);

  it("records voluntary explanation separately from real application", async () => {
    const { client, id } = await session();
    await client.call(`/api/conversations/${id}/tutor-turn`, post({ content: "Explain an FSM." }));
    await client.call(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "A finite-state machine is a set of states with rules for changing state." }),
    );
    await client.call(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "Locked --coin--> Unlocked, then push returns to Locked." }),
    );
    const evidence = (await client.json("/api/export"))["evidence"] as Json[];
    expect(evidence.map((item) => item["dimension"])).toEqual(["explanation", "application"]);
  }, 10_000);
});
