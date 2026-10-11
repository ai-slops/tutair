import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { useRef } from "react";
import type { ChatGptConnection, CorrectionKind, ProviderStatus } from "../model";
import { useFocusTrap } from "../useFocusTrap";
import { ChatGptSettings } from "./ChatGptSettings";

type DialogProps = {
  readonly kind: "settings" | "delete" | "correction";
  readonly provider: ProviderStatus;
  readonly chatgpt: ChatGptConnection;
  readonly busy: boolean;
  readonly correction: string;
  readonly correctionKind: CorrectionKind;
  readonly onCorrection: (value: string) => void;
  readonly onCorrectionKind: (value: CorrectionKind) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly onSelectChatGptModel: (slug: string) => Promise<boolean>;
  readonly onBeginChatGptManual: () => Promise<string | null>;
  readonly onCompleteChatGptManual: (callbackUrl: string) => Promise<boolean>;
  readonly onDisconnectChatGpt: () => Promise<boolean>;
};

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(true, dialogRef, props.onClose, { closeBlocked: props.busy });

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog dialog-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <h2 id="dialog-title">{titleFor(props.kind)}</h2>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            onClick={props.onClose}
            disabled={props.busy}
            aria-label="Close dialog"
          >
            <X className="icon" />
          </button>
        </div>
        {bodyFor(props)}{" "}
      </section>
    </div>
  );
}

function titleFor(kind: DialogProps["kind"]): string {
  switch (kind) {
    case "settings":
      return "Session & model";
    case "delete":
      return "Delete all learning data?";
    case "correction":
      return "Suggest a correction";
  }
}

function bodyFor(props: DialogProps) {
  switch (props.kind) {
    case "settings":
      return (
        <>
          <div className="notice">
            <span className="status-dot" />
            <div>
              <strong>{props.provider.label}</strong>
              <p>{props.provider.guidance}</p>
            </div>
          </div>
          <p>
            Your local session is authenticated with an HTTP-only cookie. Tutair never asks for or
            stores a model key in this browser.
          </p>
          <ChatGptSettings
            connection={props.chatgpt}
            busy={props.busy}
            onSelectModel={props.onSelectChatGptModel}
            onBeginManual={props.onBeginChatGptManual}
            onCompleteManual={props.onCompleteChatGptManual}
            onDisconnect={props.onDisconnectChatGpt}
          />
          <a
            className="button button-secondary"
            href="/model-setup.html"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="icon" />
            Open model setup guide
          </a>
          <button
            className="button button-primary"
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? <span className="spinner" /> : null}Refresh current session
          </button>
        </>
      );
    case "delete":
      return (
        <>
          <div className="notice notice-error">
            <AlertTriangle className="icon" />
            <span>
              This permanently deletes conversations, knowledge revisions, sources, and evidence for
              this local session. Export first if you need a copy.
            </span>
          </div>
          <label className="dialog-stack">
            <span>
              Type <strong>DELETE</strong> to confirm
            </span>
            <input
              className="modal-field"
              value={props.correction}
              onChange={(event) => props.onCorrection(event.currentTarget.value)}
              autoComplete="off"
            />
          </label>
          <div className="cluster" style={{ justifyContent: "flex-end" }}>
            <button
              className="button button-secondary"
              type="button"
              onClick={props.onClose}
              disabled={props.busy}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              type="button"
              onClick={props.onConfirm}
              disabled={props.busy || props.correction !== "DELETE"}
            >
              {props.busy ? <span className="spinner" /> : null}Delete permanently
            </button>
          </div>
        </>
      );
    case "correction":
      return (
        <>
          <p>
            Describe what should change. Corrections create a new revision; the prior definition and
            its evidence remain inspectable.
          </p>
          <label className="dialog-stack">
            <span>Correction intent</span>
            <select
              className="modal-field"
              value={props.correctionKind}
              onChange={(event) => {
                switch (event.currentTarget.value) {
                  case "claim_more":
                    props.onCorrectionKind("claim_more");
                    return;
                  case "claim_less":
                    props.onCorrectionKind("claim_less");
                    return;
                  case "invalidate_evidence":
                    props.onCorrectionKind("invalidate_evidence");
                    return;
                  case "meaning_mismatch":
                    props.onCorrectionKind("meaning_mismatch");
                    return;
                  default:
                    props.onCorrectionKind("revise");
                }
              }}
            >
              <option value="revise">Revise the definition</option>
              <option value="claim_more">The definition claims too little</option>
              <option value="claim_less">The definition claims too much</option>
              <option value="invalidate_evidence">Invalidate attached evidence</option>
              <option value="meaning_mismatch">This describes a different meaning</option>
            </select>
          </label>
          <label className="dialog-stack">
            <span>Correction</span>
            <textarea
              className="modal-field"
              value={props.correction}
              onChange={(event) => props.onCorrection(event.currentTarget.value)}
              rows={5}
            />
          </label>
          <div className="cluster" style={{ justifyContent: "flex-end" }}>
            <button className="button button-secondary" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={props.onConfirm}
              disabled={props.busy || props.correction.trim().length === 0}
            >
              {props.busy ? <span className="spinner" /> : null}Submit correction
            </button>
          </div>
        </>
      );
  }
}
