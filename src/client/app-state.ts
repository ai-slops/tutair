import type { KnowledgeItem } from "./model";

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
  clear: () => void,
): Promise<void> {
  const content = draft.trim();
  if (content.length === 0) return;
  if (await send(content)) clear();
}
