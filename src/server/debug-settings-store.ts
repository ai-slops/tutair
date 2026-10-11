import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";
import { isoNow } from "./types.js";

const settingRow = z.object({ save_provider_reasoning_summaries: z.number().int() });

export class DebugSettingsStore {
  constructor(private readonly db: Database) {}

  get(owner: LearnerId): { readonly saveProviderReasoningSummaries: boolean } {
    const row = this.db.one(
      "SELECT save_provider_reasoning_summaries FROM learner_debug_settings WHERE learner_id=?",
      [owner],
      settingRow,
    );
    return { saveProviderReasoningSummaries: row?.save_provider_reasoning_summaries === 1 };
  }

  put(owner: LearnerId, enabled: boolean): { readonly saveProviderReasoningSummaries: boolean } {
    this.db.run(
      `INSERT INTO learner_debug_settings(learner_id,save_provider_reasoning_summaries,updated_at)
       VALUES(?,?,?) ON CONFLICT(learner_id) DO UPDATE SET
       save_provider_reasoning_summaries=excluded.save_provider_reasoning_summaries,
       updated_at=excluded.updated_at`,
      [owner, enabled ? 1 : 0, isoNow()],
    );
    return { saveProviderReasoningSummaries: enabled };
  }
}
