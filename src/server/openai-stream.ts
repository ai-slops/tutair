import { z } from "zod";
import type { ProviderCallResult, ProviderUsage } from "./provider.js";
import { ApiError } from "./types.js";

const eventSchema = z.object({
  error: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().int().default(0),
        delta: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .nullish(),
});

export async function readJsonStream(
  response: Response,
  envelopeMode: "bare" | "json-fence" = "bare",
): Promise<ProviderCallResult> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new ApiError(502, "provider_invalid_stream", "Provider did not return an event stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let dataLines: string[] = [];
  let content = "";
  let usage: ProviderUsage | null = null;
  let finished = false;
  let receivedBytes = 0;

  function consumeEvent(): boolean {
    const data = dataLines.join("\n");
    dataLines = [];
    if (!data) return false;
    if (data === "[DONE]") return true;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new ApiError(
        502,
        "provider_invalid_stream",
        "Provider returned a malformed stream event",
      );
    }
    const event = eventSchema.parse(raw);
    if (event.error !== undefined && event.error !== null) {
      throw new ApiError(
        502,
        "provider_stream_error",
        "Provider reported an error before completion",
      );
    }
    if (event.usage)
      usage = {
        inputTokens: event.usage.prompt_tokens,
        outputTokens: event.usage.completion_tokens,
        totalTokens: event.usage.total_tokens,
      };
    for (const choice of event.choices) {
      if (choice.index !== 0) continue;
      if (choice.delta.refusal)
        throw new ApiError(502, "provider_refusal", "Provider declined the request");
      content += choice.delta.content ?? "";
      if (content.length > 262_144)
        throw new ApiError(502, "provider_output_too_large", "Provider output exceeds its limit");
      if (choice.finish_reason === "length" || choice.finish_reason === "max_tokens") {
        throw new ApiError(
          502,
          "provider_truncated_output",
          "Provider output reached its token limit",
        );
      }
      if (choice.finish_reason === "stop" || choice.finish_reason === "end_turn") finished = true;
      else if (choice.finish_reason)
        throw new ApiError(502, "provider_stream_error", "Provider did not finish normally");
    }
    return false;
  }

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      receivedBytes += next.value.byteLength;
      if (receivedBytes > 4_194_304)
        throw new ApiError(502, "provider_output_too_large", "Provider stream exceeds its limit");
      buffer += decoder.decode(next.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        if (line === "" && consumeEvent()) {
          if (!finished || !content.trim())
            throw new ApiError(
              502,
              "provider_incomplete_stream",
              "Provider ended without a complete answer",
            );
          try {
            const envelope =
              envelopeMode === "json-fence"
                ? /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(content.trim())
                : null;
            return { value: JSON.parse(envelope?.[1] ?? content), usage };
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            throw new ApiError(502, "provider_invalid_json", "Provider returned invalid JSON");
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
    throw new ApiError(
      502,
      "provider_incomplete_stream",
      "Provider stream ended before its completion marker",
    );
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
