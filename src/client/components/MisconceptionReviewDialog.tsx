import { AlertTriangle, X } from "lucide-react";
import { useRef, useState } from "react";
import type { MisconceptionItem, ReviewAction } from "../model";
import { useFocusTrap } from "../useFocusTrap";

type Props = {
  readonly pending: {
    readonly item: MisconceptionItem;
    readonly action: Exclude<ReviewAction, "reviewed">;
  };
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    item: MisconceptionItem,
    action: ReviewAction,
    reason?: string,
    confirmed?: boolean,
  ) => Promise<boolean>;
};

export function MisconceptionReviewDialog(props: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useFocusTrap(true, dialogRef, props.onClose, { closeBlocked: props.busy });
  const needsReason = props.pending.action !== "restore";
  const submit = async () => {
    setAttempted(true);
    if (needsReason && reason.trim() === "") return;
    if (await props.onSubmit(props.pending.item, props.pending.action, reason.trim(), confirmed)) {
      props.onClose();
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog dialog-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="misconception-review-title"
      >
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <div>
            <p className="eyebrow">Potential general learning risk</p>
            <h2 id="misconception-review-title">
              {props.pending.action === "restore"
                ? "Restore misconception"
                : props.pending.action === "retire"
                  ? "Retire misconception"
                  : "Mark misconception incorrect"}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            disabled={props.busy}
            onClick={props.onClose}
          >
            <X className="icon" />
          </button>
        </div>
        {props.pending.action === "restore" ? (
          <>
            <div className="notice">
              <AlertTriangle className="icon" />
              <span>
                Restoring makes this record eligible for future tutor context when all linked
                definitions remain current and eligible.
              </span>
            </div>
            <label className="confirmation-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>I understand and want to restore this record.</span>
            </label>
          </>
        ) : (
          <label className="field-stack">
            <span>Reason</span>
            <textarea
              className="modal-field"
              rows={5}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            {attempted && reason.trim() === "" ? (
              <span className="field-error" role="alert">
                Enter a reason before continuing.
              </span>
            ) : null}
          </label>
        )}
        {attempted && props.error !== null ? (
          <div className="notice notice-error" role="alert">
            {props.error}
          </div>
        ) : null}
        <div className="cluster review-dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={props.busy}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className={
              props.pending.action === "restore" ? "button button-primary" : "button button-danger"
            }
            type="button"
            disabled={props.busy || (props.pending.action === "restore" && !confirmed)}
            onClick={() => void submit()}
          >
            {props.busy ? <span className="spinner" /> : null} Confirm
          </button>
        </div>
      </section>
    </div>
  );
}
