import { Archive, Check, CircleX, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { MisconceptionItem, ReviewAction, ReviewStatusName } from "../model";
import { MisconceptionReviewDialog } from "./MisconceptionReviewDialog";

type Props = {
  readonly items: readonly MisconceptionItem[];
  readonly error: string | null;
  readonly onReview: (
    id: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ) => Promise<boolean>;
};

type PendingReview = {
  readonly item: MisconceptionItem;
  readonly action: Exclude<ReviewAction, "reviewed">;
};

export function MisconceptionManager(props: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ReviewStatusName>("all");
  const [selectedId, setSelectedId] = useState<string | null>(props.items[0]?.id ?? null);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [reviewing, setReviewing] = useState<ReviewAction | null>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      props.items.filter(
        (item) =>
          (status === "all" || item.reviewStatus === status) &&
          (normalized === "" ||
            `${item.label} ${item.mistakenProposition} ${item.correction}`
              .toLocaleLowerCase()
              .includes(normalized)),
      ),
    [normalized, props.items, status],
  );
  const selected = props.items.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  const review = async (
    item: MisconceptionItem,
    action: ReviewAction,
    reason = "",
    confirmed = false,
  ) => {
    if (reviewing !== null) return false;
    setReviewing(action);
    try {
      return await props.onReview(item.id, action, reason, confirmed);
    } finally {
      setReviewing(null);
    }
  };

  return (
    <>
      <aside className="manager-filters" aria-label="Misconception filters">
        <h2>Find learning risks</h2>
        <label className="search">
          <Search className="icon" aria-hidden="true" />
          <span className="sr-only">Search misconceptions</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Risk or correction"
          />
        </label>
        <label className="field-stack">
          <span>Review status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as "all" | ReviewStatusName)}
          >
            <option value="all">All statuses</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="reviewed">Reviewed</option>
            <option value="incorrect">Incorrect</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <p className="muted">
          These are potential general learning risks, never diagnoses or claims about a learner.
        </p>
      </aside>
      <section className="manager-list" aria-labelledby="misconception-list-heading">
        <div className="manager-section-heading">
          <h2 id="misconception-list-heading">Misconceptions</h2>
          <span>{visible.length} shown</span>
        </div>
        {visible.length === 0 ? (
          <p className="manager-empty">No misconceptions match these filters.</p>
        ) : (
          <div className="manager-list-rows">
            {visible.map((item) => (
              <button
                className="manager-row"
                type="button"
                key={item.id}
                aria-current={selected?.id === item.id ? "true" : undefined}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="manager-row-heading">{item.label}</span>
                <span className={`status-badge status-${item.reviewStatus}`}>
                  {item.reviewStatus}
                </span>
                <span className="manager-row-summary">Potential general learning risk</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <main className="manager-detail">
        {selected === null ? (
          <div className="manager-empty">
            <h2>No misconception selected</h2>
            <p>Choose a record to inspect its correction and definition links.</p>
          </div>
        ) : (
          <article className="manager-reader">
            <header className="manager-reader-header">
              <div>
                <div className="manager-metadata">
                  <span className={`status-badge status-${selected.reviewStatus}`}>
                    {selected.reviewStatus}
                  </span>
                  <span>Revision {selected.revision}</span>
                  <span>Potential general learning risk</span>
                </div>
                <h2>{selected.label}</h2>
              </div>
              <div className="manager-actions">
                {selected.reviewStatus === "retired" ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => setPending({ item: selected, action: "restore" })}
                  >
                    <RotateCcw className="icon" /> Restore
                  </button>
                ) : (
                  <>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={reviewing !== null || selected.reviewStatus === "reviewed"}
                      onClick={() => void review(selected, "reviewed")}
                    >
                      <Check className="icon" /> Mark reviewed
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setPending({ item: selected, action: "mark_incorrect" })}
                    >
                      <CircleX className="icon" /> Mark incorrect
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      onClick={() => setPending({ item: selected, action: "retire" })}
                    >
                      <Archive className="icon" /> Retire
                    </button>
                  </>
                )}
              </div>
            </header>
            <section className="manager-definition">
              <p className="eyebrow">Mistaken proposition</p>
              <p>{selected.mistakenProposition}</p>
              <p className="eyebrow">Correction</p>
              <p>{selected.correction}</p>
            </section>
            <section className="manager-reader-section">
              <h3>Observable failure mode</h3>
              <p>
                <strong>Task:</strong> {selected.failureTask}
              </p>
              <p>
                <strong>Likely error:</strong> {selected.likelyError}
              </p>
            </section>
            <section className="manager-reader-section">
              <h3>Discriminating example</h3>
              <p>{selected.discriminatingExample.scenario}</p>
              <p>
                <strong>Mistaken response:</strong>{" "}
                {selected.discriminatingExample.mistakenResponse}
              </p>
              <p>
                <strong>Corrected response:</strong>{" "}
                {selected.discriminatingExample.correctedResponse}
              </p>
              <p className="muted">Decisive cue: {selected.discriminatingExample.decisiveCue}</p>
            </section>
            <section className="manager-reader-section">
              <h3>Definition revision links</h3>
              <ul className="source-list">
                {selected.definitionRevisionLinks.map((link) => (
                  <li key={`${link.definitionRevisionId}:${link.role}`}>
                    <strong>{link.role.replace("_", " ")}</strong>: {link.learningValue}
                  </li>
                ))}
              </ul>
            </section>
          </article>
        )}
      </main>
      {pending === null ? null : (
        <MisconceptionReviewDialog
          pending={pending}
          busy={reviewing !== null}
          error={props.error}
          onClose={() => setPending(null)}
          onSubmit={review}
        />
      )}
    </>
  );
}
