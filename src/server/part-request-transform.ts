import { ok } from "@slop-lab/part";
import type { Contracts, Model } from "@slop-lab/part/reference/index.js";
import { z } from "zod";

const objectBody = z.record(z.string(), z.unknown());

export const tutorRequestTransform = (
  mode: "strict" | "compatibility" | "responses",
): Model.RequestTransform => ({
  id: `tutair/${mode}-wire-contract`,
  async apply(request) {
    const body = objectBody.parse(JSON.parse(new TextDecoder().decode(request.body)));
    switch (mode) {
      case "responses":
        body["include"] = [];
        body["store"] = false;
        body["stream"] = true;
        break;
      case "compatibility":
        delete body["stream_options"];
        break;
      case "strict":
        break;
      default: {
        const unreachable: never = mode;
        return unreachable;
      }
    }
    return ok({
      ...request,
      body: new TextEncoder().encode(JSON.stringify(body)),
      metadata: request.metadata as Contracts.Json,
    });
  },
});
