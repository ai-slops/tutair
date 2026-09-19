import { BookMarked, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { resolveKnowledgeSelection, sendDraft } from "./app-state";
import { Conversation } from "./components/Conversation";
import { Dialog } from "./components/Dialogs";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { Sidebar, ThreadsTrigger } from "./components/Sidebar";
import type { CorrectionKind, SearchResult } from "./model";
import { useWorkspace } from "./useWorkspace";

type DialogKind = "settings" | "delete" | "correction";

export function App() {
  const workspace = useWorkspace(api);
  const [draft, setDraft] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [learningQuery, setLearningQuery] = useState("");
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [correctionKind, setCorrectionKind] = useState<CorrectionKind>("revise");
  const activeThread = workspace.snapshot.threads.find(
    (thread) => thread.id === workspace.snapshot.activeThreadId,
  );
  const title = activeThread?.title ?? "New learning conversation";

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "/" &&
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setThreadsOpen(true);
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>(".search input")?.focus(),
        );
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const selected = useMemo(
    () => resolveKnowledgeSelection(workspace.snapshot.knowledge, selectedKnowledgeId),
    [selectedKnowledgeId, workspace.snapshot.knowledge],
  );

  async function submit(): Promise<void> {
    await sendDraft(draft, workspace.send, () => setDraft(""));
  }

  function openSearchResult(result: SearchResult): void {
    switch (result.entityType) {
      case "thread":
        void workspace.openSearchThread(result.id);
        setThreadsOpen(false);
        return;
      case "knowledge":
        setSelectedKnowledgeId(result.id);
        setKnowledgeOpen(true);
        setThreadsOpen(false);
        return;
      case "message":
      case "evidence":
        return;
    }
  }

  async function confirmDialog(): Promise<void> {
    if (dialog === null) return;
    switch (dialog) {
      case "settings":
        await workspace.createSession();
        break;
      case "delete":
        await workspace.deleteAll();
        break;
      case "correction":
        if (selected !== null) await workspace.correct(selected, dialogValue, correctionKind);
        break;
    }
    setDialog(null);
    setDialogValue("");
    setCorrectionKind("revise");
  }

  return (
    <div className="app-shell">
      <Sidebar
        open={threadsOpen}
        titleQuery={titleQuery}
        learningQuery={learningQuery}
        threads={workspace.snapshot.threads}
        search={workspace.search}
        activeThreadId={workspace.snapshot.activeThreadId}
        onClose={() => setThreadsOpen(false)}
        onNew={() => {
          void workspace.createThread();
          setThreadsOpen(false);
        }}
        onTitleQuery={setTitleQuery}
        onLearningQuery={setLearningQuery}
        onSearch={() => {
          void workspace.search.run(learningQuery);
        }}
        onSearchResult={openSearchResult}
        onSelect={(id) => {
          void workspace.openConversation(id);
          setThreadsOpen(false);
        }}
        onSettings={() => setDialog("settings")}
        onExport={() => {
          window.location.assign(api.exportUrl());
        }}
        onDelete={() => setDialog("delete")}
      />
      <main className="main-pane">
        <header className="main-header">
          <div className="header-actions">
            <ThreadsTrigger onClick={() => setThreadsOpen(true)} />
            <div className="title-wrap">
              <p className="eyebrow">Learning thread</p>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="provider-status"
              type="button"
              data-mode={workspace.snapshot.provider.mode}
              onClick={() => setDialog("settings")}
              title={workspace.snapshot.provider.guidance}
              aria-label={`${workspace.snapshot.provider.label}. ${workspace.snapshot.provider.guidance}`}
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="provider-label">{workspace.snapshot.provider.label}</span>
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setKnowledgeOpen(true)}
              aria-label="Open knowledge"
            >
              <BookMarked className="icon" />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setDialog("settings")}
              aria-label="Open settings"
            >
              <Settings className="icon" />
            </button>
          </div>
        </header>
        <Conversation
          messages={workspace.snapshot.messages}
          provider={workspace.snapshot.provider}
          draft={draft}
          submitting={workspace.loading}
          error={workspace.error}
          onDraft={setDraft}
          onSubmit={() => {
            void submit();
          }}
          onRetry={() => {
            void workspace.refresh();
          }}
          onKnowledge={() => setKnowledgeOpen(true)}
        />
      </main>
      {threadsOpen || knowledgeOpen ? (
        <div
          className="drawer-backdrop"
          data-layer={threadsOpen ? "threads" : "knowledge"}
          aria-hidden="true"
          onClick={() => {
            if (threadsOpen) setThreadsOpen(false);
            else setKnowledgeOpen(false);
          }}
        />
      ) : null}
      <KnowledgePanel
        open={knowledgeOpen}
        items={workspace.snapshot.knowledge}
        selected={selected}
        onClose={() => setKnowledgeOpen(false)}
        onSelect={(item) => setSelectedKnowledgeId(item.id)}
        onCorrect={(item) => {
          setSelectedKnowledgeId(item.id);
          setDialog("correction");
        }}
      />
      {dialog === null ? null : (
        <Dialog
          kind={dialog}
          provider={workspace.snapshot.provider}
          busy={workspace.loading}
          correction={dialogValue}
          correctionKind={correctionKind}
          onCorrection={setDialogValue}
          onCorrectionKind={setCorrectionKind}
          onClose={() => {
            setDialog(null);
            setDialogValue("");
            setCorrectionKind("revise");
          }}
          onConfirm={() => {
            void confirmDialog();
          }}
        />
      )}
    </div>
  );
}
