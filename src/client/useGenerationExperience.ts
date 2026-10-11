import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationTarget } from "./generation-contract";
import { useGenerationPipeline } from "./useGenerationPipeline";
import type { WorkspaceApi } from "./workspace";

export function useGenerationExperience(
  api: WorkspaceApi,
  activeConversationId: string | null,
  liveTarget: GenerationTarget | null,
  liveActive: boolean,
  onTerminal: () => void,
) {
  const [inspected, setInspected] = useState<GenerationTarget | null>(null);
  const liveConversationId = liveTarget?.conversationId ?? null;
  const liveRequestId = liveTarget?.requestId ?? null;
  const inspectedConversationId = inspected?.conversationId ?? null;
  const inspectedRequestId = inspected?.requestId ?? null;
  const loadLive = useCallback(
    (signal: AbortSignal) => {
      if (liveConversationId === null || liveRequestId === null)
        return Promise.reject(new TypeError("No active generation target"));
      return api.generationPipeline(
        { conversationId: liveConversationId, requestId: liveRequestId },
        signal,
      );
    },
    [api, liveConversationId, liveRequestId],
  );
  const loadInspected = useCallback(
    (signal: AbortSignal) => {
      if (inspectedConversationId === null || inspectedRequestId === null)
        return Promise.reject(new TypeError("No inspected generation target"));
      return api.generationPipeline(
        { conversationId: inspectedConversationId, requestId: inspectedRequestId },
        signal,
      );
    },
    [api, inspectedConversationId, inspectedRequestId],
  );
  const live = useGenerationPipeline(liveTarget, liveActive, loadLive);
  const refreshedRequest = useRef<string | null>(null);
  useEffect(() => {
    if (live.pipeline === null || live.pipeline.state === "running") return;
    if (refreshedRequest.current === live.pipeline.requestId) return;
    refreshedRequest.current = live.pipeline.requestId;
    onTerminal();
  }, [live.pipeline, onTerminal]);
  const historical = useGenerationPipeline(inspected, false, loadInspected);
  const sameTarget =
    inspected !== null &&
    liveTarget !== null &&
    inspected.conversationId === liveTarget.conversationId &&
    inspected.requestId === liveTarget.requestId;
  const inspectedState = sameTarget ? live : historical;
  const loadRun = useCallback(
    (runId: string, signal: AbortSignal) => {
      if (inspected === null)
        return Promise.reject(new TypeError("No inspected generation target"));
      return api.generationRun(inspected, runId, signal);
    },
    [api, inspected],
  );
  return useMemo(
    () => ({
      livePipeline: live.pipeline,
      open: (requestId: string) => {
        const conversationId =
          liveTarget?.requestId === requestId ? liveTarget.conversationId : activeConversationId;
        if (conversationId !== null) setInspected({ conversationId, requestId });
      },
      close: () => setInspected(null),
      inspector: {
        open: inspected !== null,
        pipeline: inspectedState.pipeline,
        error: inspectedState.error,
        loadRun,
      },
    }),
    [
      activeConversationId,
      inspected,
      inspectedState.error,
      inspectedState.pipeline,
      live.pipeline,
      liveTarget,
      loadRun,
    ],
  );
}
