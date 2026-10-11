import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ChatGptConnection } from "../model";

type ChatGptSettingsProps = {
  readonly connection: ChatGptConnection;
  readonly busy: boolean;
  readonly onSelectModel: (slug: string) => Promise<boolean>;
  readonly onCompleteManual: (callbackUrl: string) => Promise<boolean>;
  readonly onDisconnect: () => Promise<boolean>;
};

export function ChatGptSettings(props: ChatGptSettingsProps) {
  const [callbackUrl, setCallbackUrl] = useState("");
  const [manualError, setManualError] = useState(false);
  if (!props.connection.enabled) return null;
  if (!props.connection.connected)
    return (
      <section className="detail-section" aria-labelledby="chatgpt-heading">
        <h3 id="chatgpt-heading">Personal ChatGPT</h3>
        {props.connection.manualCallback ? (
          <div className="manual-auth-flow">
            <p>
              Authorize this learner in a new tab. When the localhost page cannot open, copy its
              full address and return here.
            </p>
            <form
              action="/api/chatgpt/manual/authorize"
              method="post"
              target="_blank"
              rel="noopener"
            >
              <button className="button button-primary" type="submit" disabled={props.busy}>
                <ExternalLink className="icon" />
                Continue with ChatGPT
              </button>
            </form>
            <ol className="manual-auth-steps">
              <li>Approve access in the official ChatGPT authorization page.</li>
              <li>At the failed 127.0.0.1 page, copy the full URL from the address bar.</li>
              <li>Paste it below to finish this same learner&apos;s connection.</li>
            </ol>
            <label className="dialog-stack">
              <span>Full localhost callback URL</span>
              <input
                className="modal-field"
                type="url"
                value={callbackUrl}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={manualError}
                aria-describedby={manualError ? "chatgpt-manual-error" : undefined}
                disabled={props.busy}
                onChange={(event) => {
                  setCallbackUrl(event.currentTarget.value);
                  setManualError(false);
                }}
              />
            </label>
            <button
              className="button button-secondary"
              type="button"
              disabled={props.busy || callbackUrl.trim().length === 0}
              onClick={() => {
                void props.onCompleteManual(callbackUrl.trim()).then((succeeded) => {
                  setManualError(!succeeded);
                  if (succeeded) setCallbackUrl("");
                });
              }}
            >
              {props.busy ? <span className="spinner" aria-hidden="true" /> : null}
              Complete ChatGPT connection
            </button>
            {manualError ? (
              <p id="chatgpt-manual-error" className="field-error" role="alert">
                Connection was not completed. Check that you pasted the full callback from this
                attempt, then try again.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <p>
              Opt in for this local learner. Authorization returns through the configured loopback
              bridge; credentials remain server-local.
            </p>
            <a
              className="button button-primary"
              href="/api/chatgpt/connect"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="icon" />
              Continue with ChatGPT
            </a>
          </>
        )}
      </section>
    );
  return (
    <section className="detail-section" aria-labelledby="chatgpt-heading">
      <h3 id="chatgpt-heading">Personal ChatGPT</h3>
      <div className="notice" role="status">
        <span className="status-dot" />
        <span>Connected for this local learner</span>
      </div>
      <label className="dialog-stack">
        <span>ChatGPT model</span>
        <select
          className="modal-field"
          value={props.connection.selectedModel ?? ""}
          disabled={props.busy}
          onChange={(event) => void props.onSelectModel(event.currentTarget.value)}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {props.connection.models.map((model) => (
            <option key={model.slug} value={model.slug}>
              {model.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button-danger"
        type="button"
        disabled={props.busy}
        onClick={() => void props.onDisconnect()}
      >
        Disconnect ChatGPT
      </button>
    </section>
  );
}
