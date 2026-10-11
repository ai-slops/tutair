import { AlertTriangle, ChevronDown, FileText, Languages } from "lucide-react";
import type { KnowledgeDocument } from "../model";

const roleLabel = (role: KnowledgeDocument["role"]): string => {
  switch (role) {
    case "english_base":
      return "English source";
    case "localization":
      return "Localization";
    case "legacy":
      return "Migrated legacy";
  }
};

export function KnowledgeDocumentHistory({
  documents,
}: {
  readonly documents: readonly KnowledgeDocument[];
}) {
  const ordered = documents.toSorted(
    (left, right) =>
      left.languageTag.localeCompare(right.languageTag) ||
      roleLabel(left.role).localeCompare(roleLabel(right.role)) ||
      right.version - left.version,
  );
  return (
    <section className="manager-reader-section" aria-labelledby="document-history-heading">
      <div className="document-section-heading">
        <h3 id="document-history-heading">
          <Languages className="icon" aria-hidden="true" /> Learner-facing documents
        </h3>
        <span>{documents.length} immutable</span>
      </div>
      <p className="muted">
        English source and localized expressions share this knowledge revision. Translation changes
        do not change its meaning or learner state.
      </p>
      {ordered.length === 0 ? (
        <p className="document-empty">No learner-facing document has been recorded.</p>
      ) : (
        <div className="document-history">
          {ordered.map((document, index) => (
            <details key={document.id} open={index === 0}>
              <summary>
                <span className="document-summary-title">
                  {document.role === "localization" ? (
                    <Languages className="icon" aria-hidden="true" />
                  ) : (
                    <FileText className="icon" aria-hidden="true" />
                  )}
                  <strong>{document.languageTag}</strong>
                  <span>{roleLabel(document.role)}</span>
                </span>
                <span className="document-summary-meta">
                  Version {document.version} · {document.blocks.length} blocks
                  <ChevronDown className="icon document-chevron" aria-hidden="true" />
                </span>
              </summary>
              {document.stale ? (
                <p className="document-stale">
                  <AlertTriangle className="icon" aria-hidden="true" /> This localization is stale
                  because its English source has a newer version.
                </p>
              ) : null}
              <dl className="document-metadata">
                <div>
                  <dt>Source</dt>
                  <dd>{document.sourceType}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(document.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
              {document.sourceRefs.length === 0 ? null : (
                <p className="muted">References: {document.sourceRefs.join(", ")}</p>
              )}
              <ol className="document-blocks">
                {document.blocks.map((block) => (
                  <li key={block.id}>
                    <div className="document-block-meta">
                      <span>{block.type.replaceAll("_", " ")}</span>
                      <span title={block.contentHash}>hash {block.contentHash.slice(0, 12)}</span>
                    </div>
                    <p>{block.content}</p>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
