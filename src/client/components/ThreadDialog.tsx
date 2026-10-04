import { X } from "lucide-react";
import { useRef, useState } from "react";
import type { LearningThreadInput, ThreadOrigin } from "../learning-model";
import { useFocusTrap } from "../useFocusTrap";

const ORIGINS = [
  "question",
  "project",
  "problem",
  "resource",
  "curriculum",
  "recommendation",
] as const satisfies readonly ThreadOrigin[];

type ThreadDialogProps = {
  readonly mode: "create" | "edit";
  readonly initial: LearningThreadInput;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (draft: LearningThreadInput) => Promise<boolean>;
};

export function ThreadDialog(props: ThreadDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const [draft, setDraft] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  useFocusTrap(true, dialogRef, props.onClose, { closeBlocked: saving });

  async function save(): Promise<void> {
    if (savingRef.current || draft.desiredOutcome.trim().length === 0) return;
    savingRef.current = true;
    setSaving(true);
    let succeeded = false;
    try {
      succeeded = await props.onSave({
        title: draft.title.trim() || draft.desiredOutcome.trim(),
        desiredOutcome: draft.desiredOutcome.trim(),
        origin: draft.origin,
        whyNow: draft.whyNow.trim(),
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (succeeded) props.onClose();
  }

  const creating = props.mode === "create";
  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog dialog-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thread-dialog-title"
      >
        <div className="cluster dialog-heading">
          <div>
            <p className="eyebrow">Learning thread</p>
            <h2 id="thread-dialog-title">{creating ? "Start a learning thread" : "Edit goal"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            disabled={saving}
            onClick={props.onClose}
          >
            <X className="icon" />
          </button>
        </div>
        <p className="muted">
          Keep the outcome durable across conversations. Origin and timing help Tutair preserve the
          reason behind the goal.
        </p>
        <label className="field-stack">
          <span>Title (optional)</span>
          <input
            className="modal-field"
            disabled={saving}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
          />
        </label>
        <label className="field-stack">
          <span>Desired outcome</span>
          <textarea
            className="modal-field"
            rows={3}
            required
            disabled={saving}
            value={draft.desiredOutcome}
            onChange={(event) => setDraft({ ...draft, desiredOutcome: event.currentTarget.value })}
          />
        </label>
        <label className="field-stack">
          <span>Origin</span>
          <select
            className="modal-field"
            disabled={saving}
            value={draft.origin}
            onChange={(event) => {
              const origin = ORIGINS.find((candidate) => candidate === event.currentTarget.value);
              if (origin !== undefined) setDraft({ ...draft, origin });
            }}
          >
            {ORIGINS.map((origin) => (
              <option key={origin} value={origin}>
                {origin[0]?.toLocaleUpperCase()}
                {origin.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-stack">
          <span>Why now?</span>
          <textarea
            className="modal-field"
            rows={3}
            disabled={saving}
            value={draft.whyNow}
            onChange={(event) => setDraft({ ...draft, whyNow: event.currentTarget.value })}
          />
        </label>
        {props.error === null ? null : (
          <div className="notice notice-error" role="alert">
            {props.error}
          </div>
        )}
        <div className="cluster dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={saving}
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={saving || draft.desiredOutcome.trim().length === 0}
            onClick={() => {
              void save();
            }}
          >
            {saving ? <span className="spinner" aria-hidden="true" /> : null}
            {creating ? "Start learning thread" : "Save changes"}
          </button>
        </div>
      </section>
    </div>
  );
}
