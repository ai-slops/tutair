import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { clearMatchingRecoveredDraft, resolveKnowledgeSelection, sendDraft } from "./app-state";
import { Conversation } from "./components/Conversation";
import { KnowledgeManager } from "./components/KnowledgeManager";
import { RecoveryNotice } from "./components/RecoveryNotice";
import { Sidebar } from "./components/Sidebar";
import { useThreadSearchShortcut } from "./components/useThreadSearchShortcut";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceLoading } from "./components/WorkspaceLoading";
import {
  type DialogKind,
  type ThreadDialogKind,
  WorkspaceOverlays,
} from "./components/WorkspaceOverlays";
import type { CorrectionKind, SearchResult } from "./model";
import { useGenerationExperience } from "./useGenerationExperience";
import { useWorkspace } from "./useWorkspace";
import "./styles/learning.css";

export function App() {
  const workspace = useWorkspace(api);
  const [draft, setDraft] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [learningQuery, setLearningQuery] = useState("");
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [threadDialog, setThreadDialog] = useState<ThreadDialogKind | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [correctionKind, setCorrectionKind] = useState<CorrectionKind>("revise");
  const [knowledgeManagerOpen, setKnowledgeManagerOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URL(window.location.href).searchParams.get("view") === "knowledge",
  );
  const initialManagerSelection =
    typeof window === "undefined" ? null : new URL(window.location.href).searchParams;
  const initialRevision = Number(initialManagerSelection?.get("revision"));
  useEffect(
    () => () => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      window.history.replaceState(null, "", url);
    },
    [],
  );
  const activeConversation = workspace.snapshot.conversations.find(
    (item) => item.id === workspace.snapshot.activeConversationId,
  );
  const activeLearningThreadId = workspace.snapshot.activeLearningThread?.id ?? null;
  useThreadSearchShortcut(useCallback(() => setThreadsOpen(true), []));

  const selected = useMemo(
    () => resolveKnowledgeSelection(workspace.snapshot.knowledge, selectedKnowledgeId),
    [selectedKnowledgeId, workspace.snapshot.knowledge],
  );
  const turnRunning = workspace.turnPending || workspace.snapshot.recovery?.kind === "running";
  const recoveryTarget =
    workspace.snapshot.recovery === null
      ? null
      : {
          conversationId: workspace.snapshot.recovery.conversationId,
          requestId: workspace.snapshot.recovery.requestId,
        };
  const generation = useGenerationExperience(
    api,
    workspace.snapshot.activeConversationId,
    workspace.activeGeneration ?? recoveryTarget,
    turnRunning,
    () => {
      if (!workspace.turnPending) void workspace.refresh();
    },
  );

  if (!workspace.initialized) return <WorkspaceLoading />;

  const setManagerView = (open: boolean): void => {
    setKnowledgeManagerOpen(open);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("view", "knowledge");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };

  if (knowledgeManagerOpen)
    return (
      <KnowledgeManager
        items={workspace.snapshot.knowledge}
        misconceptions={workspace.snapshot.misconceptions}
        error={workspace.error}
        initialSelectedId={initialManagerSelection?.get("knowledge") ?? null}
        initialRevision={
          Number.isInteger(initialRevision) && initialRevision > 0 ? initialRevision : null
        }
        onBack={() => setManagerView(false)}
        onReview={workspace.review}
        onMisconceptionReview={workspace.reviewMisconception}
        onCorrect={(item) => {
          setSelectedKnowledgeId(item.id);
          setDialog("correction");
          setManagerView(false);
        }}
      />
    );

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
          onKnowledgeManager={() => setManagerView(true)}
          onSettings={() => setDialog("settings")}
        />
        <Conversation
          messages={workspace.snapshot.messages}
          provider={workspace.snapshot.provider}
          draft={draft}
          submitting={turnRunning}
          showProgress={workspace.turnPending && workspace.snapshot.recovery === null}
          error={workspace.snapshot.recovery?.kind === "running" ? null : workspace.error}
          pipeline={generation.livePipeline}
          onDraft={setDraft}
          onSubmit={() => {
            void sendDraft(draft, workspace.send, setDraft);
          }}
          onRetry={() => {
            void workspace.refresh();
          }}
          onKnowledge={() => setKnowledgeOpen(true)}
          onInspectGeneration={generation.open}
          onLoadProvenance={(requestId) => {
            const conversationId = workspace.snapshot.activeConversationId;
            if (conversationId === null)
              return Promise.reject(new Error("Conversation provenance is unavailable"));
            return api.answerProvenance({ conversationId, requestId });
          }}
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
                onInspect={() => generation.open(workspace.snapshot.recovery?.requestId ?? "")}
              />
            )
          }
        />
      </main>
      <WorkspaceOverlays
        workspace={workspace}
        generation={generation}
        threadsOpen={threadsOpen}
        knowledgeOpen={knowledgeOpen}
        setThreadsOpen={setThreadsOpen}
        setKnowledgeOpen={setKnowledgeOpen}
        selected={selected}
        setSelectedKnowledgeId={setSelectedKnowledgeId}
        dialog={dialog}
        dialogValue={dialogValue}
        correctionKind={correctionKind}
        setDialog={setDialog}
        setDialogValue={setDialogValue}
        setCorrectionKind={setCorrectionKind}
        closeDialog={closeDialog}
        confirmDialog={confirmDialog}
        threadDialog={threadDialog}
        setThreadDialog={setThreadDialog}
        activeLearningThreadId={activeLearningThreadId}
      />
    </div>
  );
}
