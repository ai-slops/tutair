import type { z } from "zod";
import type { finalSchema } from "./tutor-schemas.js";

export type DiscardedExposure = { readonly knowledgeId: string; readonly reason: string };

export function exposureGroundingFailure(
  text: string,
  declaration: z.infer<typeof finalSchema>["exposures"][number],
  approved: ReadonlySet<string>,
): string | null {
  if (!approved.has(declaration.knowledgeId)) return "unapproved_unit";
  const quote = declaration.sourceQuote;
  const start = quote ? text.indexOf(quote) : (declaration.sourceSpan?.start ?? -1);
  const end = quote ? start + quote.length : (declaration.sourceSpan?.end ?? -1);
  if (quote && start < 0) return "quote_not_found";
  if (quote && text.indexOf(quote, start + 1) !== -1) return "ambiguous_quote";
  if (start < 0 || end <= start || end > text.length) return "invalid_span";
  for (const offset of [start, end]) {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
      return "split_code_point";
    }
  }
  return text.slice(start, end).trim().length === 0 ? "empty_span" : null;
}
