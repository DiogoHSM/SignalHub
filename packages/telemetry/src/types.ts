export type SignalStatus = "success" | "error" | "pending";
export type ErrorStatus = "open" | "investigating" | "resolved" | "ignored";
export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "critical" | "fatal";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
