import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GenerationPipeline } from "../generation-contract";
import { GenerationTimeline } from "./GenerationTimeline";

type TutorProgressProps = {
  readonly pipeline: GenerationPipeline | null;
  readonly onInspect: (requestId: string) => void;
};

export function TutorProgress({ pipeline, onInspect }: TutorProgressProps) {
  const fallbackStartedAt = useRef(Date.now());
  const persistedStartedAt = pipeline === null ? Number.NaN : Date.parse(pipeline.startedAt);
  const startedAt = Number.isFinite(persistedStartedAt)
    ? persistedStartedAt
    : fallbackStartedAt.current;
  const [elapsedSeconds, setElapsedSeconds] = useState(() => elapsedSince(startedAt));
  useEffect(() => {
    setElapsedSeconds(elapsedSince(startedAt));
    const timer = window.setInterval(() => setElapsedSeconds(elapsedSince(startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  return (
    <section className="tutor-progress">
      <Activity className="icon tutor-progress-spinner" aria-hidden="true" />
      <div className="tutor-progress-body">
        <div className="tutor-progress-copy" role="status" aria-atomic="true">
          <strong>Preparing your answer</strong>
          <span>Updates below come from recorded server stages, not an estimated percentage.</span>
        </div>
        <GenerationTimeline stages={pipeline?.stages ?? []} compact />
        {pipeline === null ? null : (
          <button
            className="button button-secondary generation-details-button"
            type="button"
            onClick={() => onInspect(pipeline.requestId)}
          >
            View generation details
          </button>
        )}
      </div>
      <span className="tutor-progress-elapsed" aria-hidden="true">
        Elapsed {minutes}:{seconds}
      </span>
    </section>
  );
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}
