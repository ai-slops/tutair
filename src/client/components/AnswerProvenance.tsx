import { BookOpen, ChevronDown, FilePlus2 } from "lucide-react";
import { useState } from "react";
import type { AnswerProvenanceRecord } from "../provenance-contract";

type AnswerProvenanceProps = {
  readonly requestId: string | undefined;
  readonly load: (requestId: string) => Promise<AnswerProvenanceRecord>;
};

export function AnswerProvenance(props: AnswerProvenanceProps) {
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<AnswerProvenanceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (props.requestId === undefined)
    return (
      <div className="answer-provenance answer-provenance-unavailable">
        <span>Sources &amp; knowledge</span>
        <small>Unavailable for this historical answer.</small>
      </div>
    );
  const requestId = props.requestId;

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (!next || record !== null || loading) return;
    setLoading(true);
    setError(null);
    void props
      .load(requestId)
      .then(setRecord)
      .catch((cause: unknown) => {
        if (!(cause instanceof Error)) throw cause;
        setError(cause.message);
      })
      .finally(() => setLoading(false));
  };

  return (
    <section className="answer-provenance">
      <button
        className="answer-provenance-trigger"
        type="button"
        onClick={toggle}
        aria-expanded={open}
      >
        <BookOpen className="icon" aria-hidden="true" />
        <span>Sources &amp; knowledge</span>
        <ChevronDown className="icon provenance-chevron" aria-hidden="true" />
      </button>
      {!open ? null : (
        <div className="answer-provenance-body">
          {loading ? <p className="muted">Loading recorded revisions…</p> : null}
          {error === null ? null : (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {record === null ? null : <ProvenanceRecord record={record} />}
        </div>
      )}
    </section>
  );
}

function ProvenanceRecord({ record }: { readonly record: AnswerProvenanceRecord }) {
  return (
    <>
      {record.availability === "unavailable" ? (
        <p className="muted">{record.reason ?? "Exact provider-call snapshots are unavailable."}</p>
      ) : null}
      <DocumentGroup title="Provided to model" documents={record.providedToModel} />
      <DocumentGroup title="Created during this answer" documents={record.created} created />
      <PreparedDocuments documents={record.createdDocuments} />
      <DocumentGroup title="Exposed in answer" documents={record.exposedInAnswer} />
      <p className="provenance-caveat">
        Exposed items come from verified answer annotations; annotations are not exhaustive.
      </p>
      <ReasoningSummaries summaries={record.reasoningSummaries} />
    </>
  );
}

function PreparedDocuments({
  documents,
}: {
  readonly documents: AnswerProvenanceRecord["createdDocuments"];
}) {
  return (
    <section className="provenance-group" aria-label="Prepared explanation documents">
      <h4>
        <FilePlus2 className="icon" aria-hidden="true" />
        Prepared explanation documents
      </h4>
      {documents.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul>
          {documents.map((document) => (
            <li key={document.documentId}>
              <span>{document.role.replaceAll("_", " ")}</span>
              <span className="provenance-meta">{document.languageTag}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DocumentGroup({
  title,
  documents,
  created = false,
}: {
  readonly title: string;
  readonly documents: AnswerProvenanceRecord["providedToModel"];
  readonly created?: boolean;
}) {
  return (
    <section className="provenance-group" aria-label={title}>
      <h4>
        {created ? <FilePlus2 className="icon" aria-hidden="true" /> : null}
        {title}
      </h4>
      {documents.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul>
          {documents.map((document) => (
            <li key={document.revisionId}>
              <a href={document.href}>
                {document.title} · revision {document.revision}
              </a>
              <span className="provenance-meta">
                {document.scope}
                {document.stages.length === 0 ? "" : ` · ${document.stages.join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReasoningSummaries({
  summaries,
}: {
  readonly summaries: AnswerProvenanceRecord["reasoningSummaries"];
}) {
  const available = summaries.filter(
    (summary): summary is Extract<(typeof summaries)[number], { state: "available" }> =>
      summary.state === "available",
  );
  const requested = summaries.some((summary) => summary.state !== "disabled");
  return (
    <section className="provenance-group" aria-label="Provider reasoning summary">
      <h4>Provider reasoning summary</h4>
      {available.map((summary) => (
        <p key={summary.runId}>
          <strong>{summary.stage}</strong> {summary.text}
        </p>
      ))}
      {available.length > 0 ? null : (
        <p className="muted">
          {requested
            ? "Not available from this model or run."
            : "Not saved because the private setting was off."}
        </p>
      )}
      <p className="provenance-caveat">
        Official provider summary only, never hidden chain-of-thought.
      </p>
    </section>
  );
}
