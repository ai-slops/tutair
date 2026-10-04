import { z } from "zod";
import type { CoreRepository } from "./repository-core.js";
import { retrievalDocument } from "./retrieval-documents.js";
import { resolveLearningThread } from "./thread-selection.js";
import type { TurnInput } from "./tutor-schemas.js";

export function selectTutorThread(
  core: CoreRepository,
  input: TurnInput,
  retrieved: readonly unknown[],
) {
  const conversation = z
    .object({ goal: z.string().nullable() })
    .parse(core.conversation(input.owner, input.conversationId));
  const query = input.content.normalize("NFKC").trim().toLocaleLowerCase();
  const candidates = retrieved.flatMap((raw) => {
    const parsed = retrievalDocument.safeParse(raw);
    if (!parsed.success || parsed.data.entity_type !== "thread") return [];
    const thread = core.thread(input.owner, parsed.data.id);
    return thread.status === "open" || thread.status === "paused"
      ? [
          {
            threadId: thread.id,
            decisive: thread.title.normalize("NFKC").trim().toLocaleLowerCase() === query,
          },
        ]
      : [];
  });
  return resolveLearningThread(core, {
    owner: input.owner,
    conversationId: input.conversationId,
    ...(input.threadId === undefined ? {} : { explicitThreadId: input.threadId }),
    ...(input.newThread === undefined ? {} : { explicitNewIntent: input.newThread }),
    candidates,
    newThread: {
      title: input.content.slice(0, 160),
      goal: (conversation.goal ?? input.content).slice(0, 1000),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.whyNow === undefined ? {} : { whyNow: input.whyNow }),
      ...(input.desiredOutcome === undefined ? {} : { desiredOutcome: input.desiredOutcome }),
    },
  }).thread;
}
