import type { Contracts, Model } from "@slop-lab/part/reference/index.js";
import { z } from "zod";

const diagnosticText = z.string().transform((value) =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 300),
);
const errorBody = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: diagnosticText.optional(),
        param: z.string().min(1).max(100).optional(),
      })
      .loose(),
  })
  .loose();
const admissionBody = z.object({ detail: diagnosticText }).loose();

const failure = (
  code: string,
  message: string,
  category: Contracts.Failure["category"],
  effect: Contracts.EffectState,
  details?: Contracts.Json,
): Contracts.Result<never> => ({
  ok: false,
  error: {
    code,
    message,
    category,
    retry: "after-reconciliation",
    effect,
    ...(details === undefined ? {} : { details }),
  },
});

export const createTutorTransport = (
  allowedOrigins: readonly string[],
  fetchImplementation: typeof fetch = fetch,
): Model.Transport => ({
  id: "tutair/fetch",
  async send(request, profile, auth, context) {
    if (profile.endpoint === undefined)
      return failure(
        "tutair.transport.endpoint",
        "Endpoint required",
        "validation",
        "not-attempted",
      );
    const url = new URL(profile.endpoint);
    if (!allowedOrigins.includes(url.origin))
      return failure(
        "tutair.transport.origin",
        "Endpoint origin is not allowed",
        "permission",
        "not-attempted",
      );
    if (auth.strategy !== "bearer" || typeof auth.material !== "string")
      return failure(
        "tutair.transport.auth",
        "Bearer credential is required",
        "permission",
        "not-attempted",
      );
    if (context.signal.aborted)
      return failure(
        "tutair.transport.cancelled",
        "Request was cancelled before delivery",
        "cancelled",
        "not-attempted",
      );
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.material}`,
          "content-type": request.mediaType,
        },
        body: Uint8Array.from(request.body),
        redirect: "error",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted)
        return failure(
          "tutair.provider_timeout",
          "Provider request timed out",
          "timeout",
          "unknown",
        );
      if (error instanceof Error)
        return failure(
          "tutair.transport.delivery",
          "Provider did not return a response",
          "unavailable",
          "unknown",
        );
      throw error;
    }
    if (!response.ok) {
      let content: string;
      try {
        content = (await response.text()).slice(0, 65_536);
      } catch (error) {
        if (context.signal.aborted)
          return failure(
            "tutair.provider_timeout",
            "Provider request timed out",
            "timeout",
            "unknown",
          );
        if (error instanceof Error)
          return failure(
            "tutair.transport.delivery",
            "Provider error body was interrupted",
            "unavailable",
            "unknown",
          );
        throw error;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(content);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const parsed = errorBody.safeParse(body);
      const admission = admissionBody.safeParse(body);
      const requestId = response.headers.get("x-request-id");
      const param = parsed.success ? parsed.data.error.param : undefined;
      return failure(
        parsed.success ? parsed.data.error.code : "tutair.provider_http_error",
        parsed.success
          ? (parsed.data.error.message ?? "Provider request failed")
          : admission.success
            ? admission.data.detail
            : "Provider request failed",
        response.status === 429 ? "unavailable" : "validation",
        "unknown",
        {
          status: response.status,
          ...(requestId === null ? {} : { requestId }),
          ...(param === undefined ? {} : { param }),
        },
      );
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return {
      ok: true,
      value: {
        status: response.status,
        headers,
        body: (async function* () {
          if (response.body === null) return;
          const reader = response.body.getReader();
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) return;
              yield chunk.value;
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        })(),
      },
    };
  },
});
