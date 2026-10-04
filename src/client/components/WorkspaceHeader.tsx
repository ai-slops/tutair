import { BookMarked, PencilLine, Settings } from "lucide-react";
import type { ProviderStatus } from "../model";
import { ThreadsTrigger } from "./Sidebar";

type WorkspaceHeaderProps = {
  readonly title: string;
  readonly provider: ProviderStatus;
  readonly canEditGoal: boolean;
  readonly onThreads: () => void;
  readonly onEditGoal: () => void;
  readonly onKnowledge: () => void;
  readonly onSettings: () => void;
};

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  return (
    <header className="main-header">
      <div className="header-actions">
        <ThreadsTrigger onClick={props.onThreads} />
        <div className="title-wrap">
          <p className="eyebrow">Conversation</p>
          <h1>{props.title}</h1>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="provider-status"
          type="button"
          data-mode={props.provider.mode}
          onClick={props.onSettings}
          title={props.provider.guidance}
          aria-label={`${props.provider.label}. ${props.provider.guidance}`}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="provider-label">{props.provider.label}</span>
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={props.onEditGoal}
          disabled={!props.canEditGoal}
          aria-label="Edit learning thread goal"
        >
          <PencilLine className="icon" />
        </button>
        <button
          className="icon-button mobile-only overview-trigger"
          type="button"
          onClick={props.onKnowledge}
          aria-label="Open overview"
        >
          <BookMarked className="icon" />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={props.onSettings}
          aria-label="Open settings"
        >
          <Settings className="icon" />
        </button>
      </div>
    </header>
  );
}
