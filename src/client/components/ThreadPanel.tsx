import { Flag, MessageSquarePlus, Play } from "lucide-react";
import type { ConversationSummary, LearningThread, LearningThreadStatus } from "../learning-model";

const DATE_FORMATTER = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const THREAD_STATUS_LABELS = {
  open: "Open",
  paused: "Paused",
  resolved: "Resolved",
  abandoned: "Abandoned",
} as const satisfies Record<LearningThreadStatus, string>;
const THREAD_STATUS_ACTIONS = {
  open: [
    { label: "Pause", status: "paused" },
    { label: "Resolve", status: "resolved" },
    { label: "Abandon", status: "abandoned" },
  ],
  paused: [
    { label: "Reopen", status: "open" },
    { label: "Resolve", status: "resolved" },
    { label: "Abandon", status: "abandoned" },
  ],
  resolved: [
    { label: "Reopen", status: "open" },
    { label: "Abandon", status: "abandoned" },
  ],
  abandoned: [{ label: "Reopen", status: "open" }],
} as const satisfies Record<
  LearningThreadStatus,
  readonly { readonly label: string; readonly status: LearningThreadStatus }[]
>;

type ThreadPanelProps = {
  readonly conversations: readonly ConversationSummary[];
  readonly learningThreads: readonly LearningThread[];
  readonly activeConversationId: string | null;
  readonly activeLearningThreadId: string | null;
  readonly threadStatusBusy: boolean;
  readonly onNewConversation: () => void;
  readonly onStartLearningThread: () => void;
  readonly onSelectConversation: (id: string) => void;
  readonly onResumeLearningThread: (id: string) => void;
  readonly onSetLearningThreadStatus: (
    id: string,
    status: LearningThreadStatus,
  ) => Promise<boolean>;
};

export function ThreadPanel(props: ThreadPanelProps) {
  return (
    <div className="thread-indexes">
      <section className="thread-index" aria-labelledby="conversation-index-heading">
        <div className="index-heading">
          <div>
            <p className="eyebrow">Message history</p>
            <h2 id="conversation-index-heading">Conversations</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="New conversation"
            onClick={props.onNewConversation}
          >
            <MessageSquarePlus className="icon" />
          </button>
        </div>
        {props.conversations.length === 0 ? (
          <p className="muted">Your conversations will appear here.</p>
        ) : (
          <div className="thread-list">
            {props.conversations.map((conversation) => (
              <button
                className="thread-row"
                type="button"
                key={conversation.id}
                aria-current={conversation.id === props.activeConversationId ? "page" : undefined}
                onClick={() => props.onSelectConversation(conversation.id)}
              >
                <span className="thread-row-title">{conversation.title}</span>
                <time className="thread-row-meta" dateTime={conversation.updatedAt}>
                  {formatDate(conversation.updatedAt)}
                </time>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="thread-index" aria-labelledby="learning-index-heading">
        <div className="index-heading">
          <div>
            <p className="eyebrow">Durable goals</p>
            <h2 id="learning-index-heading">Learning threads</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Start learning thread"
            onClick={props.onStartLearningThread}
          >
            <Flag className="icon" />
          </button>
        </div>
        {props.learningThreads.length === 0 ? (
          <p className="muted">Start a learning thread to carry a goal across conversations.</p>
        ) : (
          <div className="learning-thread-list">
            {props.learningThreads.map((thread) => (
              <article
                className="learning-thread-row"
                data-active={thread.id === props.activeLearningThreadId}
                key={thread.id}
              >
                <div className="learning-thread-copy">
                  <strong>{thread.title}</strong>
                  <span>{thread.desiredOutcome}</span>
                  <span>{THREAD_STATUS_LABELS[thread.status]}</span>
                  {thread.id === props.activeLearningThreadId ? <span>Current</span> : null}
                  <span>From {thread.origin}</span>
                  {thread.whyNow === null ? null : <span>Why now: {thread.whyNow}</span>}
                </div>
                <div className="queue-actions">
                  {thread.id === props.activeLearningThreadId ? null : (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={props.threadStatusBusy}
                      aria-label={`Resume ${thread.desiredOutcome}`}
                      onClick={() => props.onResumeLearningThread(thread.id)}
                    >
                      <Play className="icon" aria-hidden="true" />
                      Resume
                    </button>
                  )}
                  {THREAD_STATUS_ACTIONS[thread.status].map((action) => (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={props.threadStatusBusy}
                      key={action.status}
                      aria-label={`${action.label} ${thread.desiredOutcome}`}
                      onClick={() => {
                        void props.onSetLearningThreadStatus(thread.id, action.status);
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : DATE_FORMATTER.format(date);
}
