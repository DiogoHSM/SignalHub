const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "secret",
  "api_key",
  "apikey",
  "cpf",
  "credit_card"
]);

export function sanitizeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      output[key] = SENSITIVE_KEYS.has(normalizedKey) ? "[REDACTED]" : sanitizeValue(nestedValue);
    }
    return output as T;
  }

  return value;
}
