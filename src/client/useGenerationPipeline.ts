import { useEffect, useState } from "react";
import type { GenerationPipeline, GenerationTarget } from "./generation-contract";

export type GenerationPipelineState = {
  readonly pipeline: GenerationPipeline | null;
  readonly error: string | null;
};

export function useGenerationPipeline(
  target: GenerationTarget | null,
  active: boolean,
  load: (signal: AbortSignal) => Promise<GenerationPipeline>,
): GenerationPipelineState {
  const [state, setState] = useState<GenerationPipelineState>({ pipeline: null, error: null });
  const conversationId = target?.conversationId ?? null;
  const requestId = target?.requestId ?? null;

  useEffect(() => {
    if (conversationId === null || requestId === null) {
      setState({ pipeline: null, error: null });
      return;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    let current = true;
    const schedule = (): void => {
      if (!active || !current) return;
      timer = window.setTimeout(() => void poll(), 2_000);
    };
    const poll = async (): Promise<void> => {
      if (!current) return;
      try {
        const pipeline = await load(controller.signal);
        if (!current) return;
        setState({ pipeline, error: null });
        if (pipeline.state === "running") schedule();
      } catch (cause) {
        if (!current || controller.signal.aborted) return;
        if (!(cause instanceof Error)) throw cause;
        setState((value) => ({ ...value, error: cause.message }));
        schedule();
      }
    };
    setState({ pipeline: null, error: null });
    void poll();
    return () => {
      current = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, conversationId, load, requestId]);

  return state;
}
