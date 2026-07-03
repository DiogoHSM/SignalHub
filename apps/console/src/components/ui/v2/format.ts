// ---------------------------------------------------------------------------
// Shared formatting utilities
// ---------------------------------------------------------------------------

/** Exact locale-formatted number for KPI values and deltas. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Compact number formatter for dense KPI/chart values.
 *
 * Unlike `formatCompact`, this compacts from 1K upward for chart legends and
 * large dashboard cards where horizontal space is constrained.
 */
export function formatCompactNumber(n: number): string {
  const sign = n < 0 ? "-" : "";
  const absolute = Math.abs(n);
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}${formatNumber(absolute)}`;
}

/**
 * Compact number formatter for tab badges and counts.
 *
 * Design rules:
 *   n < 10,000      → exact, locale-formatted  (e.g. "2,481", "287")
 *   10,000 ≤ n < 1M → rounded K                (e.g. "31K", "184K")
 *   n ≥ 1M          → two-decimal M             (e.g. "4.82M")
 */
export function formatCompact(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Compact duration formatter for MTTR and similar millisecond durations.
 *
 * Rules:
 *   null          → "—"
 *   < 60 min      → whole minutes, e.g. "42 min"
 *   >= 60 min     → one-decimal hours, e.g. "1.5 h"
 */
export function formatDurationShort(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}

/**
 * Latency formatter for LLM metrics.
 *   null      → "—"
 *   < 1000 ms → whole ms, e.g. "842 ms"
 *   >= 1000ms → one-decimal seconds, e.g. "2.4 s"
 */
export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** USD formatter: "$ 48.21" (two decimals). */
export function formatUsd(n: number): string {
  return `$ ${n.toFixed(2)}`;
}

/**
 * Human-readable relative time from an ISO timestamp.
 * Returns strings like "8s ago", "32m ago", "4h ago", "2d ago".
 */
export function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1_000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Formats an ISO timestamp as "YYYY-MM-DD HH:MM:SS.mmm UTC" (UTC fields).
 * Invalid input returns an em-dash.
 */
export function formatUtcTimestamp(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const ms = pad(d.getUTCMilliseconds(), 3);
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms} UTC`;
}

/**
 * Formats an ISO timestamp as "HH:MM:SS" (UTC fields), for dense timeline rows.
 * Invalid input returns an em-dash.
 */
export function formatClockUtc(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
