import { describe, expect, it } from "vitest";
import { embedLocal, localEmbeddingProfile } from "../../src/server/local-embeddings.js";

describe("local semantic embeddings", () => {
  it("produces no vectors when the input batch is empty", async () => {
    // Given an empty collection, when embedded, then no model output is invented.
    expect(await embedLocal([])).toEqual([]);
  });

  it.runIf(process.env["TEST_LOCAL_EMBEDDINGS"] === "1")(
    "ranks a paraphrase above unrelated text using a pinned model",
    async () => {
      // Given different wording for the same concept and an unrelated document.
      const texts = [
        "A machine with finite states and transitions.",
        "A finite state automaton changes state in response to events.",
        "Bread rises when yeast ferments.",
      ];
      // When the real local model embeds all three.
      const vectors = await embedLocal(texts);
      const [query, related, unrelated] = vectors;
      if (!query || !related || !unrelated) throw new Error("Missing embedding vectors");
      const relatedScore = query.reduce((sum, value, i) => sum + value * (related[i] ?? 0), 0);
      const unrelatedScore = query.reduce((sum, value, i) => sum + value * (unrelated[i] ?? 0), 0);
      // Then semantic similarity, shape and normalization are meaningful.
      expect(localEmbeddingProfile).toContain("751bff37182d3f1213fa05d7196b954e230abad9");
      expect(vectors.every((vector) => vector.length === 384)).toBe(true);
      expect(query.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1, 4);
      expect(relatedScore).toBeGreaterThan(unrelatedScore + 0.3);
    },
    180_000,
  );
});
