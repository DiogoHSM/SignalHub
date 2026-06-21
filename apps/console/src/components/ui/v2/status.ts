export type Status = "ok" | "warning" | "critical" | "idle";
export type StatusEntry = { color: string; bg: string; border: string; label: string };

export const STATUS: Record<Status, StatusEntry> = {
  ok:       { color: "var(--accent)",       bg: "var(--accent-bg-subtle)", border: "var(--accent-border)",       label: "Operacional" },
  warning:  { color: "var(--sev-warning)",  bg: "var(--sev-warning-bg)",   border: "var(--sev-warning-border)",  label: "Atenção" },
  critical: { color: "var(--sev-critical)", bg: "var(--sev-critical-bg)",  border: "var(--sev-critical-border)", label: "Crítico" },
  idle:     { color: "var(--fg-muted)",     bg: "var(--bg-surface-3)",     border: "var(--border-subtle)",       label: "Inativo" }
};

export const sev = (s: string): StatusEntry => (STATUS as Record<string, StatusEntry>)[s] ?? STATUS.idle;
