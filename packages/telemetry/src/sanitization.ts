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
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, SanitizedValue> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeValue(nestedValue);
    }
    return output;
  }

  return value as SanitizedValue;
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
