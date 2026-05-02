export type SanitizeOptions = {
  maxStringLength?: number;
};

export type PayloadSizeResult = {
  ok: boolean;
  bytes: number;
};

const DEFAULT_MAX_STRING_LENGTH = 20_000;
const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

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
const PREVIEW_KEYS = new Set(["inputpreview", "outputpreview", "stack", "message", "error"]);
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
    normalizedKey.includes("privatekey") ||
    normalizedKey.includes("passwordhash")
  );
}

function isPreviewKey(key: string): boolean {
  return PREVIEW_KEYS.has(normalizeKey(key));
}

function truncateString(value: string, maxStringLength: number): string {
  return value.length > maxStringLength ? value.slice(0, maxStringLength) : value;
}

function redactPreviewText(value: string): string {
  return PREVIEW_CREDENTIAL_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    value
  );
}

function sanitizeValue(
  value: unknown,
  options: Required<SanitizeOptions>,
  key?: string,
  activeObjects = new WeakSet<object>()
): unknown {
  if (typeof value === "string") {
    const truncated = truncateString(value, options.maxStringLength);
    return key !== undefined && isPreviewKey(key) ? redactPreviewText(truncated) : truncated;
  }

  if (Array.isArray(value)) {
    if (activeObjects.has(value)) {
      return CIRCULAR;
    }

    activeObjects.add(value);
    const output = value.map((item) => sanitizeValue(item, options, undefined, activeObjects));
    activeObjects.delete(value);
    return output;
  }

  if (value && typeof value === "object") {
    if (activeObjects.has(value)) {
      return CIRCULAR;
    }

    activeObjects.add(value);
    const output: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[nestedKey] = isSensitiveKey(nestedKey)
        ? REDACTED
        : sanitizeValue(nestedValue, options, nestedKey, activeObjects);
    }
    activeObjects.delete(value);
    return output;
  }

  return value;
}

export function sanitizePayload<T extends Record<string, unknown>>(
  payload: T,
  options: SanitizeOptions = {}
): T {
  return sanitizeValue(payload, {
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  }) as T;
}

export function enforcePayloadSize(payload: Record<string, unknown>, maxBytes: number): PayloadSizeResult {
  const serialized = safeStringify(payload);

  if (serialized === undefined) {
    return {
      ok: false,
      bytes: Number.POSITIVE_INFINITY
    };
  }

  const bytes = new TextEncoder().encode(serialized).byteLength;

  return {
    ok: bytes <= maxBytes,
    bytes
  };
}

function safeStringify(payload: unknown): string | undefined {
  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}
