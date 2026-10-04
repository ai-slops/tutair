import { AlertCircle } from "lucide-react";
import type { TrackingStatus } from "../learning-model";

type TrackingNoticeProps = {
  readonly status: TrackingStatus;
};

export function TrackingNotice(props: TrackingNoticeProps) {
  const skipped = [
    props.status.evaluationSkipped ? "Evaluation skipped" : null,
    props.status.exposureTrackingSkipped ? "Exposure tracking skipped" : null,
    props.status.followupTrackingSkipped ? "Follow-up tracking skipped" : null,
    props.status.lintSkipped ? "Response review skipped" : null,
  ].filter((label): label is string => label !== null);
  if (skipped.length === 0 && !props.status.extractionFallback) return null;

  return (
    <aside className="notice notice-tracking" role="status" aria-label="Response tracking notes">
      <AlertCircle className="icon" aria-hidden="true" />
      <div className="tracking-notice-copy">
        {skipped.map((label) => (
          <p key={label}>{label}</p>
        ))}
        {props.status.extractionFallback ? <p>Structured extraction used a fallback.</p> : null}
      </div>
    </aside>
  );
}
