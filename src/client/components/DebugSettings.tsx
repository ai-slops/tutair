import type { DebugSettings as DebugSettingsValue } from "../provenance-contract";

type DebugSettingsProps = {
  readonly value: DebugSettingsValue;
  readonly busy: boolean;
  readonly onSave: (value: DebugSettingsValue) => Promise<boolean>;
};

export function DebugSettings(props: DebugSettingsProps) {
  return (
    <section className="detail-section" aria-labelledby="debug-settings-heading">
      <h3 id="debug-settings-heading">Private debugging</h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={props.value.saveProviderReasoningSummaries}
          disabled={props.busy}
          onChange={(event) =>
            void props.onSave({ saveProviderReasoningSummaries: event.currentTarget.checked })
          }
        />
        <span className="settings-toggle-copy">
          <strong>Save provider reasoning summaries for debugging</strong>
          <small>
            Off by default. Requests official Responses API summaries only; hidden chain-of-thought
            is never requested or stored.
          </small>
        </span>
      </label>
      <p className="muted">
        Changes apply to new model runs. Previously saved summaries remain private until learning
        data is erased.
      </p>
    </section>
  );
}
