import { Archive, Check, CircleX, History, PencilLine, RotateCcw } from "lucide-react";
import type { KnowledgeItem, ReviewAction } from "../model";

type DetailProps = {
  readonly item: KnowledgeItem;
  readonly reviewing: ReviewAction | null;
  readonly onReviewed: () => void;
  readonly onAction: (action: Exclude<ReviewAction, "reviewed">) => void;
  readonly onCorrect: () => void;
};

const actionLabel = (action: KnowledgeItem["reviewHistory"][number]["action"]): string => {
  switch (action) {
    case "reviewed":
      return "Reviewed revision";
    case "mark_incorrect":
      return "Marked revision incorrect";
    case "retire":
      return "Retired unit";
    case "restore":
      return "Restored unit";
  }
};

export function KnowledgeManagerDetail(props: DetailProps) {
  const { item } = props;
  return (
    <article className="manager-reader">
      <header className="manager-reader-header">
        <div>
          <div className="manager-metadata">
            <span className={`status-badge status-${item.reviewStatus.status}`}>
              {item.reviewStatus.status}
            </span>
            <span>{item.scope}</span>
            <span>{item.kind}</span>
            <span>Revision {item.revision}</span>
          </div>
          <h2>{item.name}</h2>
          {item.semanticScope === "" ? null : <p className="muted">{item.semanticScope}</p>}
        </div>
        <div className="manager-actions">
          {item.reviewStatus.status === "retired" ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => props.onAction("restore")}
              disabled={props.reviewing === "restore"}
            >
              <RotateCcw className="icon" />
              {props.reviewing === "restore" ? "Restoring…" : "Restore unit"}
            </button>
          ) : (
            <>
              <button
                className="button button-secondary"
                type="button"
                onClick={props.onReviewed}
                disabled={props.reviewing === "reviewed" || item.reviewStatus.status === "reviewed"}
              >
                <Check className="icon" />
                {props.reviewing === "reviewed"
                  ? "Reviewing…"
                  : item.reviewStatus.status === "reviewed"
                    ? "Reviewed"
                    : "Mark reviewed"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => props.onAction("mark_incorrect")}
                disabled={props.reviewing === "mark_incorrect"}
              >
                <CircleX className="icon" /> Mark incorrect
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => props.onAction("retire")}
                disabled={props.reviewing === "retire"}
              >
                <Archive className="icon" /> Retire unit
              </button>
            </>
          )}
          <button className="button button-secondary" type="button" onClick={props.onCorrect}>
            <PencilLine className="icon" /> Suggest correction
          </button>
        </div>
      </header>
      <section className="manager-definition">
        <p className="eyebrow">Current immutable definition</p>
        <p>{item.definition}</p>
        {item.reviewStatus.reason === null ? null : (
          <div className="notice notice-error">
            <strong>Review reason</strong>
            <span>{item.reviewStatus.reason}</span>
          </div>
        )}
      </section>
      <section className="manager-reader-section">
        <h3>Provenance</h3>
        {item.sources.length === 0 ? (
          <p className="muted">No source was recorded for this revision.</p>
        ) : (
          <ul className="source-list">
            {item.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="manager-reader-section">
        <h3>
          <History className="icon" aria-hidden="true" /> Revision history
        </h3>
        <div className="manager-history">
          {item.revisions.toReversed().map((revision) => (
            <details key={revision.id} open={revision.revision === item.revision}>
              <summary>
                <span>Revision {revision.revision}</span> · {revision.sourceType}
              </summary>
              {revision.revision === item.revision ? (
                <p className="muted">Current definition shown above.</p>
              ) : (
                <p>{revision.statement}</p>
              )}
              <p className="muted">
                {revision.sourceRef ?? "No source reference"} ·{" "}
                {new Date(revision.createdAt).toLocaleString()}
              </p>
            </details>
          ))}
        </div>
      </section>
      <section className="manager-reader-section">
        <h3>Review history</h3>
        {item.reviewHistory.length === 0 ? (
          <p className="muted">This definition has not been reviewed yet.</p>
        ) : (
          <ol className="review-history">
            {item.reviewHistory.map((event) => (
              <li key={event.id}>
                <strong>{actionLabel(event.action)}</strong>
                <span>
                  Revision {event.revision} · {new Date(event.createdAt).toLocaleString()}
                </span>
                {event.reason === null ? null : <p>{event.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
