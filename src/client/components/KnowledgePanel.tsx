import { BookMarked, CheckCircle2, FileText, PencilLine, X } from "lucide-react";
import { useRef } from "react";
import { DIMENSIONS, type DimensionName, type KnowledgeItem } from "../model";
import { useFocusTrap } from "../useFocusTrap";
import { LearnerStatePanel } from "./LearnerStatePanel";

type KnowledgePanelProps = {
  readonly open: boolean;
  readonly items: readonly KnowledgeItem[];
  readonly selected: KnowledgeItem | null;
  readonly onClose: () => void;
  readonly onSelect: (item: KnowledgeItem) => void;
  readonly onCorrect: (item: KnowledgeItem) => void;
};

export function KnowledgePanel(props: KnowledgePanelProps) {
  const paneRef = useRef<HTMLElement>(null);
  useFocusTrap(props.open, paneRef, props.onClose, { mediaQuery: "(max-width: 70rem)" });

  return (
    <aside
      ref={paneRef}
      className="knowledge-pane"
      data-open={props.open}
      aria-label="Knowledge and evidence"
    >
      <div className="pane-header">
        <div>
          <p className="eyebrow">Evidence margin</p>
          <h2>Knowledge</h2>
        </div>
        <button
          className="icon-button mobile-only"
          type="button"
          onClick={props.onClose}
          aria-label="Close knowledge"
        >
          <X className="icon" />
        </button>
      </div>
      <div className="pane-content">
        <p className="muted">
          Exposure records what appeared in your learning, not what you have mastered.
        </p>
        <DimensionStrip items={props.items} onSelect={props.onSelect} />
        <ConceptList items={props.items} selected={props.selected} onSelect={props.onSelect} />
        {props.selected === null ? (
          <div className="detail-section">
            <BookMarked className="icon" />
            <h3>No concept selected</h3>
            <p className="muted">
              Choose a dimension with evidence to inspect definitions, revisions, and sources.
            </p>
          </div>
        ) : (
          <KnowledgeDetail item={props.selected} onCorrect={props.onCorrect} />
        )}
      </div>
    </aside>
  );
}

function ConceptList({
  items,
  selected,
  onSelect,
}: {
  readonly items: readonly KnowledgeItem[];
  readonly selected: KnowledgeItem | null;
  readonly onSelect: (item: KnowledgeItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="detail-section" aria-labelledby="knowledge-concepts-heading">
      <h3 id="knowledge-concepts-heading">Concepts</h3>
      <div className="concept-list">
        {items.map((item) => {
          const exposureCount = item.evidence.filter(
            (evidence) => evidence.dimension === null,
          ).length;
          return (
            <button
              className="concept-row"
              type="button"
              key={item.id}
              aria-label={`Inspect ${item.name}`}
              aria-pressed={selected?.id === item.id}
              onClick={() => onSelect(item)}
            >
              <span>{item.name}</span>
              <span className="dimension-evidence">
                {exposureCount === 0
                  ? "Evidence available"
                  : `${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"} recorded`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DimensionStrip({
  items,
  onSelect,
}: {
  readonly items: readonly KnowledgeItem[];
  readonly onSelect: (item: KnowledgeItem) => void;
}) {
  return (
    <div className="dimension-grid">
      {DIMENSIONS.map((dimension) => {
        const matches = items.flatMap((item) =>
          item.evidence.filter((evidence) => evidence.dimension === dimension),
        );
        const item = items.find((candidate) =>
          candidate.evidence.some((evidence) => evidence.dimension === dimension),
        );
        return (
          <button
            className="dimension"
            type="button"
            key={dimension}
            disabled={item === undefined}
            onClick={() => {
              if (item !== undefined) onSelect(item);
            }}
          >
            <span className="dimension-name">{dimension}</span>
            <span className="dimension-evidence">
              {describeEvidence(dimension, matches.length)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function describeEvidence(dimension: DimensionName, count: number): string {
  if (count === 0) return "No evidence yet";
  return `${count} ${count === 1 ? "observation" : "observations"} involving ${dimension.toLocaleLowerCase()}`;
}

function KnowledgeDetail({
  item,
  onCorrect,
}: {
  readonly item: KnowledgeItem;
  readonly onCorrect: (item: KnowledgeItem) => void;
}) {
  return (
    <article>
      <div className="detail-section">
        <p className="eyebrow">Immutable revision {item.revision}</p>
        <h3>{item.name}</h3>
        <p>{item.definition}</p>
        <button className="button button-secondary" type="button" onClick={() => onCorrect(item)}>
          <PencilLine className="icon" />
          Suggest a correction
        </button>
      </div>
      <LearnerStatePanel item={item} />
      <section className="detail-section">
        <h3>
          <FileText className="icon" aria-hidden="true" /> Sources
        </h3>
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
      <section className="detail-section">
        <h3>
          <CheckCircle2 className="icon" aria-hidden="true" /> Evidence
        </h3>
        {item.evidence.length === 0 ? (
          <p className="muted">No learning evidence is attached.</p>
        ) : (
          item.evidence.map((evidence) => (
            <div key={evidence.id}>
              <p>
                <strong>{evidence.dimension ?? "Unclassified evidence"}</strong> ·{" "}
                {evidence.summary}
              </p>
              <p className="muted">{evidence.source}</p>
            </div>
          ))
        )}
      </section>
    </article>
  );
}
