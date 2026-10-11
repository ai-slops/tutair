import { ArrowLeft, Library, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { KnowledgeItem, ReviewAction, ReviewStatusName } from "../model";
import { KnowledgeManagerDetail } from "./KnowledgeManagerDetail";
import { KnowledgeReviewDialog } from "./KnowledgeReviewDialog";

type KnowledgeManagerProps = {
  readonly items: readonly KnowledgeItem[];
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onReview: (
    itemId: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ) => Promise<boolean>;
  readonly onCorrect: (item: KnowledgeItem) => void;
};

type StatusFilter = "all" | ReviewStatusName;
type ScopeFilter = "all" | KnowledgeItem["scope"];
type PendingAction = Exclude<ReviewAction, "reviewed">;

export function KnowledgeManager(props: KnowledgeManagerProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(props.items[0]?.id ?? null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reviewing, setReviewing] = useState<ReviewAction | null>(null);
  const [inlineReviewFailed, setInlineReviewFailed] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      props.items.filter(
        (item) =>
          (status === "all" || item.reviewStatus.status === status) &&
          (scope === "all" || item.scope === scope) &&
          (normalizedQuery === "" ||
            `${item.name} ${item.definition} ${item.semanticScope}`
              .toLocaleLowerCase()
              .includes(normalizedQuery)),
      ),
    [normalizedQuery, props.items, scope, status],
  );
  const selected =
    visible.find((item) => item.id === selectedId) ??
    props.items.find((item) => item.id === selectedId) ??
    visible[0] ??
    null;
  const selectedOutsideFilters =
    selected !== null && !visible.some((item) => item.id === selected.id);

  const review = async (
    itemId: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ): Promise<boolean> => {
    if (reviewing !== null) return false;
    setReviewing(action);
    try {
      return await props.onReview(itemId, action, reason, confirmed);
    } finally {
      setReviewing(null);
    }
  };

  const markReviewed = async (): Promise<void> => {
    if (selected === null) return;
    setInlineReviewFailed(false);
    const succeeded = await review(selected.id, "reviewed", "", false);
    setInlineReviewFailed(!succeeded);
  };

  return (
    <div className="knowledge-manager-shell">
      <header className="manager-header">
        <button
          className="button button-secondary"
          type="button"
          onClick={props.onBack}
          aria-label="Back to conversation"
        >
          <ArrowLeft className="icon" /> <span>Back to conversation</span>
        </button>
        <div className="manager-title">
          <span className="brand-mark">
            <Library className="icon" />
          </span>
          <div>
            <p className="eyebrow">Private review workspace</p>
            <h1>Knowledge manager</h1>
          </div>
        </div>
        <p className="manager-count">{props.items.length} units</p>
      </header>
      <div className="knowledge-manager-body">
        <aside className="manager-filters" aria-label="Knowledge filters">
          <h2>Find definitions</h2>
          <label className="search">
            <Search className="icon" aria-hidden="true" />
            <span className="sr-only">Search knowledge</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Title or definition"
            />
          </label>
          <label className="field-stack">
            <span>Review status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="incorrect">Incorrect</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Knowledge scope</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.currentTarget.value as ScopeFilter)}
            >
              <option value="all">All scopes</option>
              <option value="canonical">Canonical</option>
              <option value="provisional">My provisional units</option>
            </select>
          </label>
          <p className="muted">
            Review records definition accuracy. They never change mastery or authority.
          </p>
        </aside>
        <section className="manager-list" aria-labelledby="manager-list-heading">
          <div className="manager-section-heading">
            <h2 id="manager-list-heading">Definitions</h2>
            <span>{visible.length} shown</span>
          </div>
          {visible.length === 0 ? (
            <p className="manager-empty">No knowledge matches these filters.</p>
          ) : (
            <div className="manager-list-rows">
              {visible.map((item) => (
                <button
                  className="manager-row"
                  type="button"
                  key={item.id}
                  aria-current={selected?.id === item.id ? "true" : undefined}
                  onClick={() => {
                    setInlineReviewFailed(false);
                    setSelectedId(item.id);
                  }}
                >
                  <span className="manager-row-heading">{item.name}</span>
                  <span className={`status-badge status-${item.reviewStatus.status}`}>
                    {item.reviewStatus.status}
                  </span>
                  <span className="manager-row-summary">{item.semanticScope || item.kind}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <main className="manager-detail">
          {pendingAction === null && inlineReviewFailed ? (
            <div className="notice notice-error manager-empty" role="alert">
              {props.error ?? "The review could not be saved. Try again."}
            </div>
          ) : null}
          {selectedOutsideFilters ? (
            <p className="notice manager-empty" role="status">
              Selected definition is outside the current filters.
            </p>
          ) : null}
          {selected === null ? (
            <div className="manager-empty">
              <h2>No definition selected</h2>
              <p>Choose a definition to inspect its immutable history.</p>
            </div>
          ) : (
            <KnowledgeManagerDetail
              item={selected}
              reviewing={reviewing}
              onReviewed={() => void markReviewed()}
              onAction={(action) => {
                setInlineReviewFailed(false);
                setPendingAction(action);
              }}
              onCorrect={() => props.onCorrect(selected)}
            />
          )}
        </main>
      </div>
      {selected === null || pendingAction === null ? null : (
        <KnowledgeReviewDialog
          item={selected}
          action={pendingAction}
          busy={reviewing === pendingAction}
          error={props.error}
          onClose={() => setPendingAction(null)}
          onSubmit={review}
        />
      )}
    </div>
  );
}
