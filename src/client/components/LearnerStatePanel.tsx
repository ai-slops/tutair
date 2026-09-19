import { DIMENSIONS, type KnowledgeItem } from "../model";

export function LearnerStatePanel({ item }: { readonly item: KnowledgeItem }) {
  return (
    <section className="detail-section" aria-labelledby="learner-state-heading">
      <div>
        <h3 id="learner-state-heading">Current revision state</h3>
        <p className="muted">Projection, not a mastery score</p>
      </div>
      <div className="learner-state-grid">
        {DIMENSIONS.map((dimension) => {
          const state = item.learnerState.find((candidate) => candidate.dimension === dimension);
          return (
            <article className="learner-state-card" key={dimension}>
              <div className="learner-state-heading">
                <h4>{dimension}</h4>
                <span className="state-status">{state?.status ?? "State unavailable"}</span>
              </div>
              {state === undefined ? (
                <p className="muted">No projection was returned for this dimension.</p>
              ) : (
                <>
                  <dl className="learner-state-values">
                    <div>
                      <dt>Estimate</dt>
                      <dd>{formatValue(state.estimate)}</dd>
                    </div>
                    <div>
                      <dt>Uncertainty</dt>
                      <dd>{formatValue(state.uncertainty)}</dd>
                    </div>
                    <div>
                      <dt>Effective evidence</dt>
                      <dd>{formatValue(state.effectiveEvidence)}</dd>
                    </div>
                  </dl>
                  <details>
                    <summary>Projection provenance</summary>
                    <dl className="projection-provenance">
                      <div>
                        <dt>Projection version</dt>
                        <dd>{state.projectionVersion}</dd>
                      </div>
                      <div>
                        <dt>Knowledge revision ID</dt>
                        <dd>{state.knowledgeRevisionId}</dd>
                      </div>
                      <div>
                        <dt>Evidence IDs</dt>
                        <dd>
                          {state.evidenceIds.length === 0 ? "None" : state.evidenceIds.join(", ")}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value);
}
