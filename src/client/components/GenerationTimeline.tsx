import { Check, CircleDashed, CircleX, RotateCcw } from "lucide-react";
import type { GenerationStage } from "../generation-contract";

type GenerationTimelineProps = {
  readonly stages: readonly GenerationStage[];
  readonly compact?: boolean;
  readonly onStage?: (runId: string) => void;
};

const labels = {
  evaluation: {
    running: "Evaluating your latest message",
    completed: "Evaluated your latest message",
  },
  extraction: { running: "Extracting relevant concepts", completed: "Extracted relevant concepts" },
  resolution: { running: "Resolving concept references", completed: "Resolved concept references" },
  planning: { running: "Planning the explanation", completed: "Planned the explanation" },
  draft: { running: "Drafting the answer", completed: "Drafted the answer" },
  lint: { running: "Checking the draft", completed: "Checked the draft" },
  final: { running: "Finalizing the response", completed: "Finalized the response" },
} as const;

export function GenerationTimeline(props: GenerationTimelineProps) {
  if (props.stages.length === 0)
    return <p className="generation-empty">Waiting for the first recorded stage.</p>;
  return (
    <ol className="generation-timeline" data-compact={props.compact === true}>
      {props.stages.map((stage) => (
        <li key={stage.runId} data-status={stage.status}>
          <StageIcon stage={stage} />
          <div>
            <span>{stageLabel(stage)}</span>
            <span className="sr-only">Status: {stage.status}</span>
            {stage.attempt > 1 ? (
              <small>
                <RotateCcw className="icon" aria-hidden="true" /> Repair attempt {stage.attempt}
              </small>
            ) : null}
          </div>
          {props.onStage === undefined ? null : (
            <button
              className="button button-ghost"
              type="button"
              onClick={() => props.onStage?.(stage.runId)}
            >
              Inspect
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function StageIcon({ stage }: { readonly stage: GenerationStage }) {
  switch (stage.status) {
    case "running":
      return <CircleDashed className="icon generation-running" aria-hidden="true" />;
    case "completed":
      return <Check className="icon" aria-hidden="true" />;
    case "failed":
      return <CircleX className="icon" aria-hidden="true" />;
  }
}

function stageLabel(stage: GenerationStage): string {
  if (stage.status === "failed") return `${labels[stage.stage].running} failed`;
  return labels[stage.stage][stage.status];
}
