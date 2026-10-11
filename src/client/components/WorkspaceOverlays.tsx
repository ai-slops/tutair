import type { Dispatch, SetStateAction } from "react";
import { learningThreadInput } from "../app-state";
import type { CorrectionKind, KnowledgeItem } from "../model";
import type { useGenerationExperience } from "../useGenerationExperience";
import type { useWorkspace } from "../useWorkspace";
import { Dialog } from "./Dialogs";
import { GenerationInspector } from "./GenerationInspector";
import { KnowledgePanel } from "./KnowledgePanel";
import { ThreadDialog } from "./ThreadDialog";

export type DialogKind = "settings" | "delete" | "correction";
export type ThreadDialogKind = "create" | "edit";
type Workspace = ReturnType<typeof useWorkspace>;
type Generation = ReturnType<typeof useGenerationExperience>;

type WorkspaceOverlaysProps = {
  readonly workspace: Workspace;
  readonly generation: Generation;
  readonly threadsOpen: boolean;
  readonly knowledgeOpen: boolean;
  readonly setThreadsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setKnowledgeOpen: Dispatch<SetStateAction<boolean>>;
  readonly selected: KnowledgeItem | null;
  readonly setSelectedKnowledgeId: Dispatch<SetStateAction<string | null>>;
  readonly dialog: DialogKind | null;
  readonly dialogValue: string;
  readonly correctionKind: CorrectionKind;
  readonly setDialog: Dispatch<SetStateAction<DialogKind | null>>;
  readonly setDialogValue: Dispatch<SetStateAction<string>>;
  readonly setCorrectionKind: Dispatch<SetStateAction<CorrectionKind>>;
  readonly closeDialog: () => void;
  readonly confirmDialog: () => Promise<void>;
  readonly threadDialog: ThreadDialogKind | null;
  readonly setThreadDialog: Dispatch<SetStateAction<ThreadDialogKind | null>>;
  readonly activeLearningThreadId: string | null;
};

export function WorkspaceOverlays(props: WorkspaceOverlaysProps) {
  return (
    <>
      {props.threadsOpen || props.knowledgeOpen ? (
        <div
          className="drawer-backdrop"
          data-layer={props.threadsOpen ? "threads" : "knowledge"}
          aria-hidden="true"
          onClick={() =>
            props.threadsOpen ? props.setThreadsOpen(false) : props.setKnowledgeOpen(false)
          }
        />
      ) : null}
      <KnowledgePanel
        open={props.knowledgeOpen}
        items={props.workspace.snapshot.knowledge}
        selected={props.selected}
        error={props.workspace.error}
        learningThread={props.workspace.snapshot.activeLearningThread}
        onClose={() => props.setKnowledgeOpen(false)}
        onSelect={(item) => props.setSelectedKnowledgeId(item.id)}
        onCorrect={(item) => {
          props.setSelectedKnowledgeId(item.id);
          props.setDialog("correction");
        }}
        onPromote={(knowledgeId) =>
          props.activeLearningThreadId === null
            ? Promise.resolve(false)
            : props.workspace.promoteKnowledge(props.activeLearningThreadId, knowledgeId)
        }
        onAddQuestion={(question) =>
          props.activeLearningThreadId === null
            ? Promise.resolve(false)
            : props.workspace.addQuestion(props.activeLearningThreadId, question)
        }
        onSetQuestionStatus={(questionId, status) =>
          props.activeLearningThreadId === null
            ? Promise.resolve(false)
            : props.workspace.setQuestionStatus(props.activeLearningThreadId, questionId, status)
        }
      />
      <GenerationInspector
        open={props.generation.inspector.open}
        pipeline={props.generation.inspector.pipeline}
        error={props.generation.inspector.error}
        loadRun={props.generation.inspector.loadRun}
        onClose={props.generation.close}
      />
      {props.dialog === null ? null : (
        <Dialog
          kind={props.dialog}
          provider={props.workspace.snapshot.provider}
          chatgpt={props.workspace.snapshot.chatgpt}
          busy={props.workspace.loading}
          correction={props.dialogValue}
          correctionKind={props.correctionKind}
          onCorrection={props.setDialogValue}
          onCorrectionKind={props.setCorrectionKind}
          onClose={props.closeDialog}
          onConfirm={() => void props.confirmDialog()}
          onSelectChatGptModel={props.workspace.selectChatGptModel}
          onBeginChatGptManual={props.workspace.beginChatGptManual}
          onCompleteChatGptManual={props.workspace.completeChatGptManual}
          onDisconnectChatGpt={props.workspace.disconnectChatGpt}
        />
      )}
      {props.threadDialog === null ? null : (
        <ThreadDialog
          mode={props.threadDialog}
          initial={learningThreadInput(props.workspace.snapshot.activeLearningThread)}
          error={props.workspace.error}
          onClose={() => props.setThreadDialog(null)}
          onSave={(input) =>
            props.threadDialog === "create"
              ? props.workspace.createLearningThread(input)
              : props.activeLearningThreadId === null
                ? Promise.resolve(false)
                : props.workspace.updateLearningThread(props.activeLearningThreadId, input)
          }
        />
      )}
    </>
  );
}
