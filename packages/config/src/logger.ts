export type LogFields = Record<string, unknown>;

export type StructuredLogger = {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
};

const sensitiveKeyPattern = /(authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|session|pepper)/i;
const sensitiveStringPattern =
  /\b(authorization:\s*Bearer\s+|password=|secret=|token=|api[_-]?key=|access[_-]?key=|cookie=|session=|pepper=)([^,\s]+)/gi;
const redactedValue = "[REDACTED]";

function redactString(value: string): string {
  return value.replace(sensitiveStringPattern, (_match, prefix: string) => `${prefix}${redactedValue}`);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const output: Record<string, unknown> = {
      name: redactString(value.name),
      message: redactString(value.message)
    };
    if (value.stack) {
      output.stack = redactString(value.stack);
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sensitiveKeyPattern.test(key) ? redactedValue : redactValue(nestedValue, seen);
    }

    return output;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = sensitiveKeyPattern.test(key) ? redactedValue : redactValue(nestedValue, seen);
  }

  return output;
}

export function redactLogFields(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export function createStructuredLogger(component: string): StructuredLogger {
  const write = (level: "debug" | "info" | "warn" | "error", fields: LogFields, message: string) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      fields: redactLogFields(fields)
    };
    const line = JSON.stringify(entry);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.info(line);
    }
  };

  return {
    debug: (fields, message) => write("debug", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message)
  };
}
