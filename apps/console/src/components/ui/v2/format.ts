// ---------------------------------------------------------------------------
// Shared formatting utilities
// ---------------------------------------------------------------------------

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
