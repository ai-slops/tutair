import { z } from "zod";

export const strictOutputSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(strictOutputSchema);
  if (value === null || typeof value !== "object") return value;
  const input = z.record(z.string(), z.unknown()).parse(value);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) output[key] = strictOutputSchema(child);
  const properties = z.record(z.string(), z.unknown()).safeParse(input["properties"]);
  if (properties.success) {
    output["properties"] = strictOutputSchema(properties.data);
    output["required"] = Object.keys(properties.data);
    output["additionalProperties"] = false;
  } else if (input["type"] === "object") {
    output["required"] = [];
    output["additionalProperties"] = false;
  }
  return output;
};
