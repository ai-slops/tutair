const SECRET_KEY = /authorization|api[-_]?key|token|secret|password|cookie|credential/i;
const SECRET_TEXT = [
  /Bearer\s+[^\s"']+/gi,
  /\bsk-[A-Za-z0-9_-]+\b/g,
  /\b(?:access|refresh|id)_token\b\s*[:=]\s*[^\s,}"']+/gi,
] as const;

const redactText = (value: string): string =>
  SECRET_TEXT.reduce((current, pattern) => current.replace(pattern, "[redacted]"), value);

export function redactDiagnostic(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactDiagnostic(item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [childKey, redactDiagnostic(child, childKey)]),
  );
}
