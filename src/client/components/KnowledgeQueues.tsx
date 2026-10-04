import { ArrowUpRight, CircleHelp, Clock3 } from "lucide-react";
import { useState } from "react";
import type { LearningQuestion, QuestionStatus } from "../learning-model";
import type { KnowledgeItem } from "../model";

type KnowledgeQueuesProps = {
  readonly deferred: readonly KnowledgeItem[];
  readonly questions: readonly LearningQuestion[];
  readonly error: string | null;
  readonly onPromote: (id: string) => Promise<boolean>;
  readonly onAddQuestion: (question: string) => Promise<boolean>;
  readonly onSetQuestionStatus: (id: string, status: QuestionStatus) => Promise<boolean>;
};

export function KnowledgeQueues(props: KnowledgeQueuesProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState("");

  async function act(key: string, operation: () => Promise<boolean>): Promise<void> {
    setPendingKey(key);
    try {
      await operation();
    } finally {
      setPendingKey(null);
    }
  }

  async function addQuestion(): Promise<void> {
    const question = questionDraft.trim();
    if (question.length === 0) return;
    setPendingKey("new-question");
    try {
      const succeeded = await props.onAddQuestion(question);
      if (succeeded) setQuestionDraft("");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="knowledge-queues">
      <section className="detail-section" aria-labelledby="deferred-knowledge-heading">
        <div className="queue-heading">
          <Clock3 className="icon" aria-hidden="true" />
          <div>
            <h3 id="deferred-knowledge-heading">Deferred knowledge</h3>
            <p className="muted">Deferred here; this does not change knowledge state.</p>
          </div>
        </div>
        {props.deferred.length === 0 ? (
          <p className="muted">No deferred knowledge.</p>
        ) : (
          <div className="queue-list">
            {props.deferred.map((unit) => {
              const key = `deferred-${unit.id}`;
              return (
                <article className="queue-row" key={unit.id}>
                  <div>
                    <strong>{unit.name}</strong>
                    <p>{unit.definition}</p>
                  </div>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={pendingKey !== null}
                    onClick={() => {
                      void act(key, () => props.onPromote(unit.id));
                    }}
                  >
                    {pendingKey === key ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight className="icon" aria-hidden="true" />
                    )}
                    Move to learning targets
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="detail-section" aria-labelledby="learning-questions-heading">
        <div className="queue-heading">
          <CircleHelp className="icon" aria-hidden="true" />
          <div>
            <h3 id="learning-questions-heading">Learning questions</h3>
            <p className="muted">Track open, parked, and resolved questions.</p>
          </div>
        </div>
        <form
          className="question-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addQuestion();
          }}
        >
          <label className="field-stack">
            <span>New open question</span>
            <input
              className="modal-field"
              value={questionDraft}
              disabled={pendingKey !== null}
              onChange={(event) => setQuestionDraft(event.currentTarget.value)}
            />
          </label>
          <button
            className="button button-secondary"
            type="submit"
            disabled={pendingKey !== null || questionDraft.trim().length === 0}
          >
            {pendingKey === "new-question" ? <span className="spinner" aria-hidden="true" /> : null}
            Add question
          </button>
        </form>
        {props.questions.length === 0 ? (
          <p className="muted">No learning questions.</p>
        ) : (
          <div className="queue-list">
            {props.questions.map((question) => {
              const key = `question-${question.id}`;
              return (
                <article className="queue-row" key={question.id}>
                  <div>
                    <p>{question.question}</p>
                    <span className="muted">Status: {question.status}</span>
                  </div>
                  <div className="queue-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={pendingKey !== null}
                      onClick={() => {
                        void act(key, () =>
                          props.onSetQuestionStatus(
                            question.id,
                            question.status === "open" ? "resolved" : "open",
                          ),
                        );
                      }}
                    >
                      {pendingKey === key ? <span className="spinner" aria-hidden="true" /> : null}
                      {question.status === "open" ? "Resolve question" : "Reopen question"}
                    </button>
                    {question.status === "open" ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={pendingKey !== null}
                        onClick={() => {
                          void act(key, () => props.onSetQuestionStatus(question.id, "parked"));
                        }}
                      >
                        Park question
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {props.error === null ? null : (
        <div className="notice notice-error" role="alert">
          {props.error}
        </div>
      )}
    </div>
  );
}
