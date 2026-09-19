const camelKey = (key: string): string =>
  key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export const presentJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(presentJson);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key =
      rawKey === "tombstoned_at"
        ? "deletedAt"
        : rawKey === "output_json"
          ? "outputJson"
          : rawKey.endsWith("_json")
            ? camelKey(rawKey.slice(0, -5))
            : camelKey(rawKey);
    if (rawKey === "role" && rawValue === "learner") result[key] = "user";
    else if ((rawKey === "synthetic" || rawKey === "ambiguous") && typeof rawValue === "number")
      result[key] = rawValue === 1;
    else if (rawKey.endsWith("_json") && typeof rawValue === "string") {
      const parsed: unknown = JSON.parse(rawValue);
      result[key] = parsed;
      if (rawKey === "output_json") result["output"] = parsed;
    } else result[key] = presentJson(rawValue);
  }
  return result;
};
