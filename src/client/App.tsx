import { useCallback, useMemo, useState } from "react";
import { api } from "./api";
import { clearMatchingRecoveredDraft, resolveKnowledgeSelection, sendDraft } from "./app-state";
import { Conversation } from "./components/Conversation";
import { Dialog } from "./components/Dialogs";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { RecoveryNotice } from "./components/RecoveryNotice";
import { Sidebar } from "./components/Sidebar";
import { ThreadDialog } from "./components/ThreadDialog";
import { useThreadSearchShortcut } from "./components/useThreadSearchShortcut";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceLoading } from "./components/WorkspaceLoading";
import type { CorrectionKind, SearchResult } from "./model";
import { useWorkspace } from "./useWorkspace";
import "./styles/learning.css";

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
  const [threadDialog, setThreadDialog] = useState<"create" | "edit" | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [correctionKind, setCorrectionKind] = useState<CorrectionKind>("revise");
  const activeConversation = workspace.snapshot.conversations.find(
    (item) => item.id === workspace.snapshot.activeConversationId,
  );
  const activeLearningThreadId = workspace.snapshot.activeLearningThread?.id ?? null;
  useThreadSearchShortcut(useCallback(() => setThreadsOpen(true), []));

  const selected = useMemo(
    () => resolveKnowledgeSelection(workspace.snapshot.knowledge, selectedKnowledgeId),
    [selectedKnowledgeId, workspace.snapshot.knowledge],
  );

  if (!workspace.initialized) return <WorkspaceLoading />;

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
    let succeeded = false;
    switch (dialog) {
      case "settings":
        succeeded = await workspace.createSession();
        break;
      case "delete":
        succeeded = await workspace.deleteAll();
        break;
      case "correction":
        if (selected !== null)
          succeeded = await workspace.correct(selected, dialogValue, correctionKind);
        break;
    }
    if (!succeeded) return;
    closeDialog();
  }

  function closeDialog(): void {
    setDialog(null);
    setDialogValue("");
    setCorrectionKind("revise");
  }

  const recoveryCandidateThreadIds = new Set(workspace.snapshot.recovery?.candidateThreadIds ?? []);

  return (
    <div className="app-shell">
      <Sidebar
        open={threadsOpen}
        titleQuery={titleQuery}
        learningQuery={learningQuery}
        conversations={workspace.snapshot.conversations}
        learningThreads={workspace.snapshot.learningThreads}
        search={workspace.search}
        activeConversationId={workspace.snapshot.activeConversationId}
        activeLearningThreadId={activeLearningThreadId}
        threadStatusBusy={workspace.loading}
        onClose={() => setThreadsOpen(false)}
        onNewConversation={() => {
          void workspace.createConversation();
          setThreadsOpen(false);
        }}
        onStartLearningThread={() => {
          setThreadDialog("create");
          setThreadsOpen(false);
        }}
        onTitleQuery={setTitleQuery}
        onLearningQuery={setLearningQuery}
        onSearch={() => {
          void workspace.search.run(learningQuery);
        }}
        onSearchResult={openSearchResult}
        onSelectConversation={(id) => {
          void workspace.openConversation(id);
          setThreadsOpen(false);
        }}
        onResumeLearningThread={(id) => {
          void workspace.openSearchThread(id);
          setThreadsOpen(false);
        }}
        onSetLearningThreadStatus={workspace.setThreadStatus}
        onSettings={() => setDialog("settings")}
        onExport={() => {
          window.location.assign(api.exportUrl());
        }}
        onDelete={() => setDialog("delete")}
      />
      <main className="main-pane">
        <WorkspaceHeader
          title={activeConversation?.title ?? "New learning conversation"}
          provider={workspace.snapshot.provider}
          canEditGoal={workspace.snapshot.activeLearningThread !== null}
          onThreads={() => setThreadsOpen(true)}
          onEditGoal={() => setThreadDialog("edit")}
          onKnowledge={() => setKnowledgeOpen(true)}
          onSettings={() => setDialog("settings")}
        />
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
          recovery={
            workspace.snapshot.recovery === null ? null : (
              <RecoveryNotice
                kind={workspace.snapshot.recovery.kind}
                content={workspace.snapshot.recovery.content}
                message={workspace.snapshot.recovery.message}
                candidates={workspace.snapshot.learningThreads.filter((thread) =>
                  recoveryCandidateThreadIds.has(thread.id),
                )}
                busy={workspace.loading}
                error={workspace.error}
                onSelect={(threadId) => workspace.resolveTurn({ threadId })}
                onStartNew={() => workspace.resolveTurn({ newThread: true })}
                onRetry={workspace.retryTurn}
                onRefresh={() => void workspace.refresh()}
                onRecovered={(content) => clearMatchingRecoveredDraft(content, setDraft)}
              />
            )
          }
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
        error={workspace.error}
        learningThread={workspace.snapshot.activeLearningThread}
        onClose={() => setKnowledgeOpen(false)}
        onSelect={(item) => setSelectedKnowledgeId(item.id)}
        onCorrect={(item) => {
          setSelectedKnowledgeId(item.id);
          setDialog("correction");
        }}
        onPromote={(knowledgeId) =>
          activeLearningThreadId === null
            ? Promise.resolve(false)
            : workspace.promoteKnowledge(activeLearningThreadId, knowledgeId)
        }
        onAddQuestion={(question) =>
          activeLearningThreadId === null
            ? Promise.resolve(false)
            : workspace.addQuestion(activeLearningThreadId, question)
        }
        onSetQuestionStatus={(questionId, status) =>
          activeLearningThreadId === null
            ? Promise.resolve(false)
            : workspace.setQuestionStatus(activeLearningThreadId, questionId, status)
        }
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
          onClose={closeDialog}
          onConfirm={() => {
            void confirmDialog();
          }}
        />
      )}
      {threadDialog === null ? null : (
        <ThreadDialog
          mode={threadDialog}
          initial={
            workspace.snapshot.activeLearningThread === null
              ? { title: "", desiredOutcome: "", origin: "question", whyNow: "" }
              : {
                  title: workspace.snapshot.activeLearningThread.title,
                  desiredOutcome: workspace.snapshot.activeLearningThread.desiredOutcome,
                  origin: workspace.snapshot.activeLearningThread.origin,
                  whyNow: workspace.snapshot.activeLearningThread.whyNow ?? "",
                }
          }
          error={workspace.error}
          onClose={() => setThreadDialog(null)}
          onSave={(input) =>
            threadDialog === "create"
              ? workspace.createLearningThread(input)
              : activeLearningThreadId === null
                ? Promise.resolve(false)
                : workspace.updateLearningThread(activeLearningThreadId, input)
          }
        />
      )}
    </div>
  );
}
