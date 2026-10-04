import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";
import { isoNow } from "./types.js";

const errorStatus = z.union([
  z.literal(400),
  z.literal(401),
  z.literal(403),
  z.literal(404),
  z.literal(409),
  z.literal(413),
  z.literal(422),
  z.literal(429),
  z.literal(500),
  z.literal(502),
  z.literal(503),
]);
const requestRow = z.object({
  request_id: z.string(),
  user_message_id: z.string(),
  base_hash: z.string(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  response_json: z.string().nullable(),
  error_status: errorStatus.nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  error_details_json: z.string().nullable(),
});
const outcomeRow = z.object({
  request_id: z.string(),
  user_message_id: z.string(),
  tutor_message_id: z.string().nullable(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  content: z.string(),
  run_json: z.string().nullable(),
  error_status: errorStatus.nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  error_details_json: z.string().nullable(),
});

export type TurnRequestRecord = z.infer<typeof requestRow>;
export type StoredTurnError = {
  readonly status: z.infer<typeof errorStatus>;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
};
type RequestKey = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly requestId: string;
};
type NewTurnRequest = RequestKey & {
  readonly userMessageId: string;
  readonly baseHash: string;
};
type CompletedTurnRequest = RequestKey & {
  readonly response: unknown;
  readonly tutorMessageId: string;
  readonly run: unknown;
};
type FailedTurnRequest = RequestKey & {
  readonly state: "needs_selection" | "failed";
  readonly error: StoredTurnError;
};

export class TurnRequestStore {
  constructor(private readonly db: Database) {}

  get(owner: LearnerId, conversationId: string, requestId: string): TurnRequestRecord | null {
    return this.db.one(
      `SELECT request_id,user_message_id,base_hash,state,response_json,error_status,
       error_code,error_message,error_details_json FROM tutor_turn_requests
       WHERE learner_id=? AND conversation_id=? AND request_id=?`,
      [owner, conversationId, requestId],
      requestRow,
    );
  }

  create(input: NewTurnRequest): void {
    const now = isoNow();
    this.db.run(
      `INSERT INTO tutor_turn_requests(
       learner_id,conversation_id,request_id,user_message_id,base_hash,state,created_at,updated_at
       ) VALUES(?,?,?,?,?,'running',?,?)`,
      [
        input.owner,
        input.conversationId,
        input.requestId,
        input.userMessageId,
        input.baseHash,
        now,
        now,
      ],
    );
  }

  markRunning(owner: LearnerId, conversationId: string, requestId: string): void {
    this.db.run(
      `UPDATE tutor_turn_requests SET state='running',error_status=NULL,error_code=NULL,
       error_message=NULL,error_details_json=NULL,updated_at=?
       WHERE learner_id=? AND conversation_id=? AND request_id=? AND state='needs_selection'`,
      [isoNow(), owner, conversationId, requestId],
    );
  }

  complete(input: CompletedTurnRequest): void {
    this.db.run(
      `UPDATE tutor_turn_requests SET state='completed',response_json=?,tutor_message_id=?,
       run_json=?,updated_at=? WHERE learner_id=? AND conversation_id=? AND request_id=?`,
      [
        JSON.stringify(input.response),
        input.tutorMessageId,
        JSON.stringify(input.run),
        isoNow(),
        input.owner,
        input.conversationId,
        input.requestId,
      ],
    );
  }

  fail(input: FailedTurnRequest): void {
    this.db.run(
      `UPDATE tutor_turn_requests SET state=?,error_status=?,error_code=?,error_message=?,
       error_details_json=?,updated_at=? WHERE learner_id=? AND conversation_id=? AND request_id=?`,
      [
        input.state,
        input.error.status,
        input.error.code,
        input.error.message,
        input.error.details === undefined ? null : JSON.stringify(input.error.details),
        isoNow(),
        input.owner,
        input.conversationId,
        input.requestId,
      ],
    );
  }

  outcomes(owner: LearnerId, conversationId: string): readonly unknown[] {
    return this.db
      .all(
        `SELECT r.request_id,r.user_message_id,r.tutor_message_id,r.state,m.content,r.run_json,
         r.error_status,r.error_code,r.error_message,r.error_details_json
         FROM tutor_turn_requests r JOIN messages m
           ON m.id=r.user_message_id AND m.learner_id=r.learner_id
         WHERE r.learner_id=? AND r.conversation_id=? ORDER BY r.created_at`,
        [owner, conversationId],
        outcomeRow,
      )
      .map((row) => {
        const run: unknown = row.run_json === null ? null : JSON.parse(row.run_json);
        const details: unknown =
          row.error_details_json === null ? null : JSON.parse(row.error_details_json);
        const error =
          row.error_status === null || row.error_code === null || row.error_message === null
            ? null
            : {
                code: row.error_code,
                message: row.error_message,
                ...(details === null ? {} : { details }),
              };
        return {
          requestId: row.request_id,
          userMessageId: row.user_message_id,
          tutorMessageId: row.tutor_message_id,
          state: row.state,
          content: row.content,
          run,
          error,
        };
      });
  }
}
