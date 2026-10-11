import { ArrowRight, GitBranch, Plus, RefreshCcw } from "lucide-react";
import { useState } from "react";
import type { LearningThread, TurnRecovery } from "../learning-model";

type RecoveryNoticeProps = {
  readonly kind: TurnRecovery["kind"];
  readonly content: string;
  readonly message: string;
  readonly candidates: readonly LearningThread[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSelect: (id: string) => Promise<boolean>;
  readonly onStartNew: () => Promise<boolean>;
  readonly onRetry: () => Promise<boolean>;
  readonly onRefresh: () => void;
  readonly onRecovered: (content: string) => void;
  readonly onInspect?: () => void;
};

export function RecoveryNotice(props: RecoveryNoticeProps) {
  const [selectingId, setSelectingId] = useState<string | null>(null);

  async function select(id: string, operation: () => Promise<boolean>): Promise<void> {
    setSelectingId(id);
    const succeeded = await operation();
    if (succeeded) props.onRecovered(props.content);
    else setSelectingId(null);
  }

  const pending = props.busy || selectingId !== null;
  if (props.kind === "unknown") {
    return (
      <aside className="notice recovery-notice" aria-labelledby="recovery-heading">
        <RefreshCcw className="icon" aria-hidden="true" />
        <div className="recovery-content">
          <div>
            <strong id="recovery-heading">Request delivery unconfirmed</strong>
            <p>{props.message}</p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={() => void select("retry", props.onRetry)}
          >
            {selectingId === "retry" ? <span className="spinner" aria-hidden="true" /> : null}
            Check request delivery
          </button>
        </div>
      </aside>
    );
  }
  if (props.kind === "running") {
    return (
      <aside className="notice recovery-notice" aria-labelledby="recovery-heading">
        <RefreshCcw className="icon" aria-hidden="true" />
        <div className="recovery-content">
          <div>
            <strong id="recovery-heading">Saved request in progress</strong>
            <p>{props.message}</p>
          </div>
          <div className="cluster">
            {props.onInspect === undefined ? null : (
              <button className="button button-secondary" type="button" onClick={props.onInspect}>
                View generation details
              </button>
            )}
            <button
              className="button button-secondary"
              type="button"
              disabled={pending}
              onClick={() => void select("retry", props.onRetry)}
            >
              {selectingId === "retry" ? <span className="spinner" aria-hidden="true" /> : null}
              Continue saved request
            </button>
          </div>
        </div>
      </aside>
    );
  }
  if (props.kind === "failed") {
    return (
      <aside className="notice recovery-notice" aria-labelledby="recovery-heading">
        <RefreshCcw className="icon" aria-hidden="true" />
        <div className="recovery-content">
          <div>
            <strong id="recovery-heading">Saved request needs attention</strong>
            <p>{props.message}</p>
          </div>
          <div className="cluster">
            {props.onInspect === undefined ? null : (
              <button className="button button-secondary" type="button" onClick={props.onInspect}>
                View generation details
              </button>
            )}
            <button className="button button-secondary" type="button" onClick={props.onRefresh}>
              <RefreshCcw className="icon" aria-hidden="true" />
              Refresh conversation
            </button>
          </div>
        </div>
      </aside>
    );
  }
  return (
    <aside className="notice recovery-notice" aria-labelledby="recovery-heading">
      <GitBranch className="icon" aria-hidden="true" />
      <div className="recovery-content">
        <div>
          <strong id="recovery-heading">Choose the learning thread for this message</strong>
          <p>
            Your message is already saved. Choose where it belongs to continue without sending it
            again.
          </p>
        </div>
        <div className="recovery-options">
          {props.candidates.map((candidate) => (
            <button
              className="recovery-option"
              type="button"
              key={candidate.id}
              disabled={pending}
              onClick={() => {
                void select(candidate.id, () => props.onSelect(candidate.id));
              }}
            >
              <span>
                <strong>{candidate.desiredOutcome}</strong>
                <small>{candidate.title}</small>
              </span>
              {selectingId === candidate.id ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span className="sr-only">Selecting</span>
                </>
              ) : (
                <ArrowRight className="icon" aria-hidden="true" />
              )}
            </button>
          ))}
          <button
            className="recovery-option"
            type="button"
            disabled={pending}
            onClick={() => {
              void select("new", props.onStartNew);
            }}
          >
            <span>
              <strong>Start a new learning thread</strong>
              <small>Use the saved message as its starting point.</small>
            </span>
            {selectingId === "new" ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span className="sr-only">Starting</span>
              </>
            ) : (
              <Plus className="icon" aria-hidden="true" />
            )}
          </button>
        </div>
        {props.error === null ? null : <p role="alert">{props.error}</p>}
      </div>
    </aside>
  );
}
