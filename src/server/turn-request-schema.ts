import { createHash } from "node:crypto";
import { z } from "zod";
import { tutorTurnSchema } from "./schemas.js";

export const tutorTurnRequestSchema = tutorTurnSchema.extend({
  requestId: z.uuid().optional(),
});

export type TutorTurnRequest = z.infer<typeof tutorTurnRequestSchema>;

export const turnRequestIdentity = (
  input: TutorTurnRequest,
): { readonly requestId: string; readonly baseHash: string } => {
  const normalizedBase = JSON.stringify({
    content: input.content,
    assistance: input.assistance,
    selfReport: input.selfReport,
    confidence: input.confidence ?? null,
    origin: input.origin ?? null,
    whyNow: input.whyNow ?? null,
    desiredOutcome: input.desiredOutcome ?? null,
  });
  return {
    requestId: input.requestId ?? crypto.randomUUID(),
    baseHash: createHash("sha256").update(normalizedBase).digest("hex"),
  };
};
