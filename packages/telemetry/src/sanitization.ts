import { generalTelemetryJsonBounds, inspectJsonBounds } from "./json-bounds.js";
export { sanitizeTelemetryUrl } from "./url-sanitization.js";

export type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "authorization",
  "cookie",
  "setcookie",
  "secret",
  "secretaccesskey",
  "awssecretaccesskey",
  "accesskey",
  "accesskeyid",
  "privatekey",
  "credential",
  "clientkey",
  "apikey",
  "cpf",
  "creditcard"
]);

const SENSITIVE_ROOTS = ["authorization", "cookie", "password", "secret"];
const SENSITIVE_KEY_PATTERNS = [
  "accesskey",
  "secretaccesskey",
  "signingkey",
  "privatekey",
  "serviceaccountkey"
];
const PREVIEW_CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(authorization)\s*[:=]\s*Bearer\s+[^\s,;'"})\]]+/gi, "$1: [REDACTED]"],
  [/\b(password)\s*[:=]\s*[^\s,;'"})\]]+/gi, "$1=[REDACTED]"],
  [/\b(access[_-]?token)\s*[:=]\s*[^\s,;'"})\]]+/gi, "$1=[REDACTED]"],
  [/\b(refresh[_-]?token)\s*[:=]\s*[^\s,;'"})\]]+/gi, "$1=[REDACTED]"],
  [/\b(api[_-]?key)\s*[:=]\s*[^\s,;'"})\]]+/gi, "$1: [REDACTED]"],
  [/\b(secret)\s*[:=]\s*[^\s,;'"})\]]+/gi, "$1=[REDACTED]"]
];
function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function matchesSensitiveRoot(normalizedKey: string): boolean {
  return SENSITIVE_ROOTS.some((root) => {
    if (root === "secret" && normalizedKey.startsWith("secretary")) {
      return normalizedKey.endsWith(root);
    }

    return normalizedKey.startsWith(root) || normalizedKey.endsWith(root);
  });
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = normalizeKey(key);

  return (
    SENSITIVE_KEYS.has(normalizedKey) ||
    matchesSensitiveRoot(normalizedKey) ||
    SENSITIVE_KEY_PATTERNS.some((pattern) => normalizedKey.includes(pattern)) ||
    normalizedKey.endsWith("token") ||
    normalizedKey.endsWith("secret") ||
    normalizedKey.endsWith("password") ||
    normalizedKey.includes("apikey") ||
    normalizedKey.includes("secretkey") ||
    normalizedKey.includes("passwordhash")
  );
}

export function sanitizeValue(value: unknown): SanitizedValue {
  const inspection = inspectJsonBounds(value, generalTelemetryJsonBounds);
  if (!inspection.ok) {
    throw new Error(`unsafe_recursive_value:${inspection.violation}`);
  }
  if (value === null || typeof value !== "object") return value as SanitizedValue;

  const outputs = new WeakMap<object, SanitizedValue[] | Record<string, SanitizedValue>>();
  const root = Array.isArray(value) ? [] : {};
  outputs.set(value, root);
  const pending: object[] = [value];

  while (pending.length > 0) {
    const source = pending.pop();
    if (!source) continue;
    const output = outputs.get(source);
    if (!output) continue;

    if (Array.isArray(source)) {
      const arrayOutput = output as SanitizedValue[];
      arrayOutput.length = source.length;
      for (let index = 0; index < source.length; index += 1) {
        if (!(index in source)) continue;
        const nestedValue = source[index];
        if (nestedValue !== null && typeof nestedValue === "object") {
          const existing = outputs.get(nestedValue);
          if (existing) {
            arrayOutput[index] = existing;
          } else {
            const nestedOutput = Array.isArray(nestedValue) ? [] : {};
            outputs.set(nestedValue, nestedOutput);
            arrayOutput[index] = nestedOutput;
            pending.push(nestedValue);
          }
        } else {
          arrayOutput[index] = nestedValue as SanitizedValue;
        }
      }
      continue;
    }

    const objectOutput = output as Record<string, SanitizedValue>;
    for (const [key, nestedValue] of Object.entries(source)) {
      if (isSensitiveKey(key)) {
        objectOutput[key] = "[REDACTED]";
        continue;
      }
      if (nestedValue !== null && typeof nestedValue === "object") {
        const existing = outputs.get(nestedValue);
        if (existing) {
          objectOutput[key] = existing;
        } else {
          const nestedOutput = Array.isArray(nestedValue) ? [] : {};
          outputs.set(nestedValue, nestedOutput);
          objectOutput[key] = nestedOutput;
          pending.push(nestedValue);
        }
      } else {
        objectOutput[key] = nestedValue as SanitizedValue;
      }
    }
  }

  return root;
}

export function sanitizePreviewText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return PREVIEW_CREDENTIAL_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    value
  );
}
