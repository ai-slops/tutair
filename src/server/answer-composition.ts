import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

export const finalSelectionSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            blockId: z.string().uuid(),
            layout: z.enum(["heading", "paragraph", "bullet"]),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.segments.map((segment) => segment.blockId)).size !== value.segments.length)
      context.addIssue({ code: "custom", message: "A source block can be selected only once" });
  });

type AvailableBlock = {
  readonly id: string;
  readonly content: string;
  readonly contentHash: string;
  readonly topicRevisionIds?: readonly string[];
};
type RenderedSegment = {
  readonly blockId: string;
  readonly layout: "heading" | "paragraph" | "bullet";
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly hash: string;
  readonly topicRevisionIds: readonly string[];
};
export type RenderedAnswer = {
  readonly text: string;
  readonly hash: string;
  readonly segments: readonly RenderedSegment[];
};

export function renderSelection(raw: unknown, blocks: readonly AvailableBlock[]): RenderedAnswer {
  const selection = finalSelectionSchema.parse(raw);
  const available = new Map(blocks.map((block) => [block.id, block]));
  const segments: RenderedSegment[] = [];
  let text = "";
  for (const selected of selection.segments) {
    const block = available.get(selected.blockId);
    if (block === undefined)
      throw new ApiError(
        422,
        "unknown_answer_block",
        "Final selection referenced an unavailable block",
      );
    const separator =
      text === ""
        ? ""
        : selected.layout === "bullet" && segments.at(-1)?.layout === "bullet"
          ? "\n"
          : "\n\n";
    const rendered =
      selected.layout === "heading"
        ? `## ${block.content}`
        : selected.layout === "bullet"
          ? `- ${block.content}`
          : block.content;
    const start = text.length + separator.length;
    text += separator + rendered;
    segments.push({
      blockId: block.id,
      layout: selected.layout,
      text: rendered,
      start,
      end: start + rendered.length,
      hash: createHash("sha256").update(rendered).digest("hex"),
      topicRevisionIds: block.topicRevisionIds ?? [],
    });
  }
  if (text.length > 20_000)
    throw new ApiError(
      422,
      "answer_budget_exceeded",
      "Selected blocks exceed the answer text budget",
    );
  return { text, hash: createHash("sha256").update(text).digest("hex"), segments };
}

export class AnswerCompositionStore {
  constructor(private readonly db: Database) {}
  save(input: {
    readonly owner: LearnerId;
    readonly messageId: string;
    readonly runId: string | null;
    readonly rendered: RenderedAnswer;
  }): void {
    const id = newId();
    this.db.run("INSERT INTO answer_compositions VALUES(?,?,?,?,?,?)", [
      id,
      input.owner,
      input.messageId,
      input.runId,
      input.rendered.hash,
      isoNow(),
    ]);
    input.rendered.segments.forEach((segment, position) => {
      this.db.run("INSERT INTO answer_composition_segments VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
        newId(),
        id,
        position,
        "block",
        segment.blockId,
        null,
        segment.layout,
        segment.text,
        segment.start,
        segment.end,
        segment.hash,
      ]);
    });
  }
  reconstruct(owner: LearnerId, messageId: string): RenderedAnswer {
    const composition = this.db.one(
      "SELECT id,content_hash FROM answer_compositions WHERE learner_id=? AND message_id=?",
      [owner, messageId],
      z.object({ id: z.string(), content_hash: z.string() }),
    );
    if (composition === null)
      throw new ApiError(404, "composition_not_found", "Answer composition not found");
    const rows = this.db.all(
      `SELECT s.source_block_id AS block_id,s.layout,b.content,b.content_hash,
       s.start_offset,s.end_offset,t.knowledge_revision_id
       FROM answer_composition_segments s JOIN knowledge_document_blocks b ON b.id=s.source_block_id
       LEFT JOIN knowledge_document_block_topics t ON t.block_id=b.id
       WHERE s.composition_id=? ORDER BY s.position,t.knowledge_revision_id`,
      [composition.id],
      z.object({
        block_id: z.string(),
        layout: z.enum(["heading", "paragraph", "bullet"]),
        content: z.string(),
        content_hash: z.string(),
        start_offset: z.number(),
        end_offset: z.number(),
        knowledge_revision_id: z.string().nullable(),
      }),
    );
    const unique = [...new Map(rows.map((row) => [row.block_id, row])).values()];
    const rendered = renderSelection(
      { segments: unique.map((row) => ({ blockId: row.block_id, layout: row.layout })) },
      unique.map((row) => ({
        id: row.block_id,
        content: row.content,
        contentHash: row.content_hash,
        topicRevisionIds: rows
          .filter((topic) => topic.block_id === row.block_id)
          .flatMap((topic) =>
            topic.knowledge_revision_id === null ? [] : [topic.knowledge_revision_id],
          ),
      })),
    );
    if (rendered.hash !== composition.content_hash)
      throw new ApiError(
        409,
        "composition_hash_mismatch",
        "Answer reconstruction hash does not match the persisted message",
      );
    return rendered;
  }
}
