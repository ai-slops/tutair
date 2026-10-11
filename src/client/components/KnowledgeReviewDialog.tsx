import { AlertTriangle, X } from "lucide-react";
import { useRef, useState } from "react";
import type { KnowledgeItem, ReviewAction } from "../model";
import { useFocusTrap } from "../useFocusTrap";

type ReviewDialogProps = {
  readonly item: KnowledgeItem;
  readonly action: Exclude<ReviewAction, "reviewed">;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    itemId: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ) => Promise<boolean>;
};

export function KnowledgeReviewDialog(props: ReviewDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [requestAttempted, setRequestAttempted] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  useFocusTrap(true, dialogRef, props.onClose, { closeBlocked: props.busy });
  const needsReason = props.action === "mark_incorrect" || props.action === "retire";
  const canSubmit = !props.busy && (props.action !== "restore" || confirmed);
  const submit = async (): Promise<void> => {
    const submittedReason = reasonRef.current?.value.trim() ?? reason.trim();
    if (needsReason && submittedReason.length === 0) {
      setValidationError("Enter a reason before continuing.");
      return;
    }
    setValidationError(null);
    setRequestAttempted(true);
    const succeeded = await props.onSubmit(props.item.id, props.action, submittedReason, confirmed);
    if (succeeded) props.onClose();
  };
  const title =
    props.action === "mark_incorrect"
      ? "Mark definition incorrect"
      : props.action === "retire"
        ? "Retire knowledge unit"
        : "Restore knowledge unit";

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog dialog-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-dialog-title"
      >
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <div>
            <p className="eyebrow">Revision {props.item.revision}</p>
            <h2 id="review-dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            aria-label="Close dialog"
          >
            <X className="icon" />
          </button>
        </div>
        {props.action === "restore" ? (
          <>
            <div className="notice">
              <AlertTriangle className="icon" />
              <span>
                Restoring makes this unit eligible for future tutor search, resolution, and
                generation context again.
              </span>
            </div>
            <label className="confirmation-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>I understand and want to make this unit eligible again.</span>
            </label>
          </>
        ) : (
          <>
            <p>
              {props.action === "mark_incorrect"
                ? "This exact revision will be excluded from future tutor knowledge context for you."
                : "This unit will remain retired across new revisions until you restore it."}
            </p>
            <label className="field-stack">
              <span>Reason</span>
              <textarea
                ref={reasonRef}
                className="modal-field"
                rows={5}
                value={reason}
                required
                aria-invalid={validationError !== null}
                aria-describedby={validationError === null ? undefined : "review-reason-error"}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setValidationError(null);
                }}
              />
              {validationError === null ? null : (
                <span id="review-reason-error" className="field-error" role="alert">
                  {validationError}
                </span>
              )}
            </label>
          </>
        )}
        {requestAttempted && props.error !== null ? (
          <div className="notice notice-error" role="alert">
            {props.error}
          </div>
        ) : null}
        <div className="cluster review-dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
          >
            Cancel
          </button>
          <button
            className={
              props.action === "restore" ? "button button-primary" : "button button-danger"
            }
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {props.busy ? <span className="spinner" /> : null}
            {props.action === "mark_incorrect"
              ? "Confirm incorrect"
              : props.action === "retire"
                ? "Confirm retirement"
                : "Confirm restore"}
          </button>
        </div>
      </section>
    </div>
  );
}
