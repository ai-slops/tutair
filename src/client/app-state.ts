import type { LearningThread, LearningThreadInput } from "./learning-model";
import type { KnowledgeItem } from "./model";

export function learningThreadInput(thread: LearningThread | null): LearningThreadInput {
  if (thread === null) return { title: "", desiredOutcome: "", origin: "question", whyNow: "" };
  return {
    title: thread.title,
    desiredOutcome: thread.desiredOutcome,
    origin: thread.origin,
    whyNow: thread.whyNow ?? "",
  };
}

export function resolveKnowledgeSelection(
  items: readonly KnowledgeItem[],
  selectedId: string | null,
): KnowledgeItem | null {
  if (selectedId === null) return items.at(0) ?? null;
  return items.find((item) => item.id === selectedId) ?? null;
}

export async function sendDraft(
  draft: string,
  send: (content: string) => Promise<boolean>,
  setDraft: (update: (current: string) => string) => void,
): Promise<void> {
  const content = draft.trim();
  if (content.length === 0) return;
  if (await send(content)) clearMatchingRecoveredDraft(draft, setDraft);
}

export function clearMatchingRecoveredDraft(
  savedContent: string,
  setDraft: (update: (current: string) => string) => void,
): void {
  setDraft((current) => (current === savedContent ? "" : current));
}
