import { AlertCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GenerationPipeline,
  GenerationRunDetail,
  GenerationStage,
} from "../generation-contract";
import { useFocusTrap } from "../useFocusTrap";
import { GenerationTimeline } from "./GenerationTimeline";

type GenerationInspectorProps = {
  readonly open: boolean;
  readonly pipeline: GenerationPipeline | null;
  readonly error: string | null;
  readonly loadRun: (runId: string, signal: AbortSignal) => Promise<GenerationRunDetail>;
  readonly onClose: () => void;
};

export function GenerationInspector(props: GenerationInspectorProps) {
  const paneRef = useRef<HTMLElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [detail, setDetail] = useState<GenerationRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  useFocusTrap(props.open, paneRef, props.onClose);
  useEffect(() => {
    if (props.open) return;
    controllerRef.current?.abort();
    setDetail(null);
    setDetailError(null);
    setLoadingRunId(null);
  }, [props.open]);

  const loadDetail = useCallback(
    async (runId: string): Promise<void> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoadingRunId(runId);
      setDetailError(null);
      try {
        setDetail(await props.loadRun(runId, controller.signal));
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (!(cause instanceof Error)) throw cause;
        setDetailError(cause.message);
      } finally {
        if (!controller.signal.aborted) setLoadingRunId(null);
      }
    },
    [props.loadRun],
  );
  const inspect = (runId: string): void => {
    if (detail?.runId === runId) {
      setDetail(null);
      return;
    }
    void loadDetail(runId);
  };
  useEffect(() => {
    if (!props.open || detail?.status !== "running") return;
    const recordedStage = props.pipeline?.stages.find((stage) => stage.runId === detail.runId);
    if (recordedStage === undefined || recordedStage.status === "running") return;
    void loadDetail(detail.runId);
  }, [detail?.runId, detail?.status, loadDetail, props.open, props.pipeline?.stages]);

  if (!props.open) return null;
  const totals = knownTotals(props.pipeline?.stages ?? []);
  return (
    <>
      <div className="generation-backdrop" aria-hidden="true" onClick={props.onClose} />
      <aside
        ref={paneRef}
        className="generation-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generation-inspector-title"
      >
        <header className="pane-header">
          <div>
            <p className="eyebrow">Recorded pipeline</p>
            <h2 id="generation-inspector-title">Generation details</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={props.onClose}
            aria-label="Close generation details"
          >
            <X className="icon" />
          </button>
        </header>
        <div className="generation-inspector-content">
          {props.error === null ? null : (
            <p className="notice notice-error" role="alert">
              {props.error}
            </p>
          )}
          {props.pipeline === null ? (
            <p className="muted">Loading the recorded pipeline…</p>
          ) : (
            <>
              <section className="generation-summary" aria-label="Generation summary">
                <div role="status" aria-live="polite" aria-atomic="true">
                  <span>Status</span>
                  <strong>{props.pipeline.state.replace("_", " ")}</strong>
                </div>
                <div>
                  <span>Known duration</span>
                  <strong>{totals.duration}</strong>
                </div>
                <div>
                  <span>Known tokens</span>
                  <strong>{totals.tokens}</strong>
                </div>
              </section>
              {props.pipeline.error === null ? null : (
                <div className="notice notice-error" role="alert">
                  <AlertCircle className="icon" aria-hidden="true" />
                  <span>
                    <strong>{props.pipeline.error.code}</strong> {props.pipeline.error.message}
                  </span>
                </div>
              )}
              <GenerationTimeline stages={props.pipeline.stages} onStage={inspect} />
              {loadingRunId === null ? null : <p className="muted">Loading recorded call…</p>}
              {detailError === null ? null : (
                <p className="notice notice-error" role="alert">
                  {detailError}
                </p>
              )}
              {detail === null ? null : <RunDetail detail={detail} />}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function knownTotals(stages: readonly GenerationStage[]): {
  readonly duration: string;
  readonly tokens: string;
} {
  const durations = stages.flatMap((stage) =>
    stage.durationMs === null ? [] : [stage.durationMs],
  );
  const usages = stages.flatMap((stage) => (stage.usage === null ? [] : [stage.usage.totalTokens]));
  return {
    duration:
      durations.length === 0 ? "Unknown" : `${durations.reduce((sum, value) => sum + value, 0)} ms`,
    tokens: usages.length === 0 ? "Unknown" : `${usages.reduce((sum, value) => sum + value, 0)}`,
  };
}

function RunDetail({ detail }: { readonly detail: GenerationRunDetail }) {
  return (
    <section className="generation-run-detail">
      <h3>
        {detail.stage} · attempt {detail.attempt}
      </h3>
      <dl className="generation-metadata">
        <div>
          <dt>Model</dt>
          <dd>{detail.model ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Provider mode</dt>
          <dd>{detail.outputMode ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{detail.durationMs === null ? "Unknown" : `${detail.durationMs} ms`}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>{formatUsage(detail.usage)}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{detail.errorCode ?? "None recorded"}</dd>
        </div>
        <div>
          <dt>Fallback</dt>
          <dd>{detail.fallbackStatus ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Stage / prompt / schema</dt>
          <dd>
            {detail.versions.stage} / {detail.versions.prompt} / {detail.versions.schema}
          </dd>
        </div>
        <div>
          <dt>Repair provenance</dt>
          <dd>{detail.repairOfRunId ?? "Original attempt"}</dd>
        </div>
      </dl>
      <DiagnosticBlock
        title="Recorded structured call"
        value={
          detail.recordedCall.available ? detail.recordedCall.value : detail.recordedCall.reason
        }
      />
      <DiagnosticBlock
        title={detail.response.validated ? "Validated stage output" : "Unvalidated provider output"}
        value={detail.response.value}
      />
      <DiagnosticBlock title="Decision traces" value={detail.traces} />
      <DiagnosticBlock
        title="Provider reasoning summary"
        value={
          detail.reasoningSummary.state === "available"
            ? detail.reasoningSummary.text
            : detail.reasoningSummary.state === "disabled"
              ? "Not saved because the private setting was off."
              : detail.reasoningSummary.state === "pending"
                ? "Waiting for the provider response."
                : "Not available from this model or run."
        }
      />
    </section>
  );
}

function formatUsage(usage: GenerationRunDetail["usage"]): string {
  if (usage === null) return "Unknown";
  return `${usage.inputTokens} input / ${usage.outputTokens} output / ${usage.totalTokens} total`;
}

function DiagnosticBlock({ title, value }: { readonly title: string; readonly value: unknown }) {
  return (
    <details className="diagnostic-block">
      <summary>{title}</summary>
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
