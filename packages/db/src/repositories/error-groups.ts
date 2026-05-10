import { createHash } from "node:crypto";

export type ErrorGroupStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorGroupingInput = {
  fingerprint?: string | null;
  message: string;
  type?: string | null;
  stack?: string | null;
};

export type ErrorGroupingFingerprint = {
  fingerprint: string;
  source: string;
  topStackFrame: string | null;
};

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const longNumberPattern = /\b\d{5,}\b/g;
const browserStackFramePattern = /^[^\s@]+@(?:https?:\/\/|file:\/\/|webpack:\/\/|\/).+:\d+:\d+$/;

export function normalizeErrorGroupingInput(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(uuidPattern, "{uuid}")
    .replace(longNumberPattern, "{number}")
    .replace(/\s+/g, " ");
}

export function extractTopStackFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const frame = stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || browserStackFramePattern.test(line));
  return frame ?? null;
}

export function buildErrorGroupingFingerprint(input: ErrorGroupingInput): ErrorGroupingFingerprint {
  const explicit = input.fingerprint?.trim();
  const topStackFrame = extractTopStackFrame(input.stack);
  if (explicit) {
    return {
      fingerprint: explicit,
      source: `explicit:${explicit}`,
      topStackFrame
    };
  }

  const source = [
    normalizeErrorGroupingInput(input.type),
    normalizeErrorGroupingInput(input.message),
    normalizeErrorGroupingInput(topStackFrame)
  ].join("|");

  return {
    fingerprint: `fp_${createHash("sha256").update(source).digest("hex").slice(0, 32)}`,
    source,
    topStackFrame
  };
}
