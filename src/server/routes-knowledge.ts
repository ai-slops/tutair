import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { parse } from "yaml";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import {
  canonicalKnowledgeYamlSchema,
  knowledgeCreateBoundarySchema,
} from "./knowledge-contracts.js";
import { documentCreateBodySchema } from "./knowledge-document-contracts.js";
import { genericRecord } from "./records.js";
import { registerEvidenceRoutes } from "./routes-evidence.js";
import { importSchema, knowledgeReviewSchema } from "./schemas.js";
import { searchKnowledge } from "./search.js";
import { ApiError, isoNow, newId } from "./types.js";

export const knowledgeRoutes = (services: Services): Hono => {
  const app = new Hono();
  app.get("/knowledge", (c) => {
    const owner = ownerFor(c, services);
    const scope = z
      .enum(["canonical", "provisional", "all"])
      .catch("all")
      .parse(c.req.query("scope"));
    return c.json({ items: services.knowledge.listWithReview(owner, scope) });
  });
  app.get("/knowledge/:id", (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    const item = services.knowledge.item(owner, id);
    return c.json({
      item,
      revisions: services.knowledge.revisions(owner, id),
      relations: services.db.all(
        "SELECT * FROM knowledge_relations WHERE from_knowledge_id=? AND (learner_id IS NULL OR learner_id=?)",
        [id, owner],
        genericRecord,
      ),
      evidence: services.knowledge.evidence(owner, id),
      exposures: services.db.all(
        "SELECT * FROM exposures WHERE learner_id=? AND knowledge_id=?",
        [owner, id],
        genericRecord,
      ),
      learnerState: services.knowledge.learnerState(owner, id, item.current_revision),
      reviewStatus: services.knowledge.reviewStatus(owner, id, item.current_revision),
      reviewHistory: services.knowledge.reviewHistory(owner, id),
      documents: services.documents.forRevision(
        z
          .object({ id: z.string() })
          .parse(services.knowledge.revision(owner, id, item.current_revision)).id,
      ),
    });
  });
  app.get("/knowledge/:id/revisions/:revision/documents", (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    const revision = z.coerce.number().int().positive().parse(c.req.param("revision"));
    const record = z
      .object({ id: z.string() })
      .parse(services.knowledge.revision(owner, id, revision));
    return c.json({ documents: services.documents.forRevision(record.id) });
  });
  app.post("/knowledge/:id/revisions/:revision/documents", async (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    const revision = z.coerce.number().int().positive().parse(c.req.param("revision"));
    const record = z
      .object({ id: z.string() })
      .parse(services.knowledge.revision(owner, id, revision));
    const body = documentCreateBodySchema.parse(await jsonBody(c));
    return c.json(
      services.documents.create({ ...body, owner, knowledgeRevisionId: record.id }),
      201,
    );
  });
  app.post("/knowledge/:id/reviews", async (c) => {
    const owner = ownerFor(c, services);
    const knowledgeId = c.req.param("id");
    services.knowledge.item(owner, knowledgeId);
    const body = knowledgeReviewSchema.parse(await jsonBody(c));
    return c.json(
      {
        event: services.knowledge.review(owner, {
          knowledgeId,
          revision: body.revision,
          action: body.action,
          reason: body.reason ?? null,
          confirmed: body.confirmed,
        }),
        reviewStatus: services.knowledge.reviewStatus(owner, knowledgeId, body.revision),
      },
      201,
    );
  });
  app.get("/knowledge/:id/revisions/:revision", (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    const revision = z.coerce.number().int().positive().parse(c.req.param("revision"));
    return c.json({
      revision: services.knowledge.revision(owner, id, revision),
      evidence: services.knowledge.evidence(owner, id, revision),
      learnerState: services.knowledge.learnerState(owner, id, revision),
    });
  });
  app.post("/knowledge", async (c) => {
    const owner = ownerFor(c, services);
    const body = knowledgeCreateBoundarySchema.parse(await jsonBody(c));
    return c.json(services.knowledge.create(owner, body), 201);
  });
  app.post("/knowledge/import", async (c) => {
    ownerFor(c, services);
    const suppliedToken = c.req.header("x-tutair-canonical-token");
    const expectedDigest = createHash("sha256")
      .update(services.canonicalImportToken ?? "")
      .digest();
    const suppliedDigest = createHash("sha256")
      .update(suppliedToken ?? "")
      .digest();
    if (
      services.canonicalImportToken === null ||
      services.canonicalImportToken === undefined ||
      suppliedToken === undefined ||
      !timingSafeEqual(suppliedDigest, expectedDigest)
    )
      throw new ApiError(
        403,
        "canonical_authority_required",
        "Canonical imports require authority credentials",
      );
    const request = importSchema.parse(await jsonBody(c));
    const document: unknown = parse(request.content);
    const data = canonicalKnowledgeYamlSchema.parse(document);
    const imported = services.db.transaction(() => {
      const results = data.items.map((item) => {
        const result = services.knowledge.create(null, {
          title: item.title,
          statement: item.statement,
          riskScope: item.riskScope,
          confidence: 1,
          canonicalKey: item.key,
          sourceRef: data.source,
          kind: item.kind,
          aliases: item.aliases,
          semanticScope: item.semanticScope,
          definitionScope: item.definitionScope,
          distinguishingFeatures: item.distinguishingFeatures,
          claims: item.claims,
          sourceRefs: [data.source],
        });
        const revision = z.object({ id: z.string() }).parse(result.revision);
        services.documents.create({
          owner: null,
          knowledgeRevisionId: revision.id,
          role: "english_base",
          languageTag: "en",
          sourceType: "canonical_import",
          sourceRefs: [data.source],
          blocks: [
            { type: "definition", content: item.statement },
            ...(item.semanticScope === ""
              ? []
              : [{ type: "scope" as const, content: item.semanticScope }]),
            ...item.distinguishingFeatures.map((content) => ({
              type: "feature" as const,
              content,
            })),
            ...item.claims.map((claim) => ({
              type: "claim" as const,
              content: typeof claim === "string" ? claim : claim.text,
            })),
          ],
        });
        return { key: item.key, result };
      });
      for (const item of data.items) {
        const source = results.find((candidate) => candidate.key === item.key);
        if (source === undefined) continue;
        const fromItem = z.object({ id: z.string() }).parse(source.result.item);
        const fromRevision = z.object({ id: z.string() }).parse(source.result.revision);
        for (const relation of item.relations) {
          const target = results.find((candidate) => candidate.key === relation.to);
          if (target === undefined)
            throw new ApiError(
              422,
              "relation_target_not_found",
              `Canonical relation target is absent: ${relation.to}`,
            );
          const toItem = z.object({ id: z.string() }).parse(target.result.item);
          const toRevision = z.object({ id: z.string() }).parse(target.result.revision);
          services.db.run("INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?,?,?,?)", [
            newId(),
            null,
            fromItem.id,
            toItem.id,
            relation.kind,
            fromRevision.id,
            toRevision.id,
            relation.necessity ?? null,
            relation.scaffoldable === undefined ? null : relation.scaffoldable ? 1 : 0,
            isoNow(),
          ]);
        }
      }
      return results.map(({ result }) => result);
    });
    return c.json({ imported }, 201);
  });
  registerEvidenceRoutes(app, services);
  app.get("/search", async (c) => {
    const owner = ownerFor(c, services);
    const query = z.string().trim().min(1).max(500).parse(c.req.query("q"));
    const limit = z.coerce.number().int().min(1).max(50).catch(20).parse(c.req.query("limit"));
    return c.json(await searchKnowledge(services.db, services.provider, owner, query, limit));
  });
  return app;
};
