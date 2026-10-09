import { ExternalLink } from "lucide-react";
import type { ChatGptConnection } from "../model";

type ChatGptSettingsProps = {
  readonly connection: ChatGptConnection;
  readonly busy: boolean;
  readonly onSelectModel: (slug: string) => Promise<boolean>;
  readonly onDisconnect: () => Promise<boolean>;
};

export function ChatGptSettings(props: ChatGptSettingsProps) {
  if (!props.connection.enabled) return null;
  if (!props.connection.connected)
    return (
      <section className="detail-section" aria-labelledby="chatgpt-heading">
        <h3 id="chatgpt-heading">Personal ChatGPT</h3>
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
          Connect ChatGPT
        </a>
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
