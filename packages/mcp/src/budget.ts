/**
 * Response budget / truncation contract shared by every tool.
 *
 * A telemetry MCP's characteristic failure mode is blowing the caller's context on one payload:
 * a list route that returns thousands of rows, or a single row that embeds a full stack trace,
 * raw event payload, or span body. Every tool routes its list-shaped fields through
 * `pruneSection` before returning, so the cap and the field redaction are enforced in one place
 * instead of being re-implemented (or forgotten) per tool.
 */

/**
 * Conservative default cap on how many items a single response section may return. 20 keeps a
 * section within a few hundred tokens even for wide records (error groups, spans, ...), leaving
 * room for a tool response that composes several sections without any one of them dominating the
 * budget. Callers that genuinely need more can raise `cap` explicitly, or follow
 * `truncated.how_to_get_more` to narrow the query instead.
 */
export const DEFAULT_SECTION_CAP = 20;

/**
 * Field names dropped by default because they tend to carry unbounded, high-token content: full
 * stack traces, raw ingested event payloads, and full span bodies. A caller that actually needs
 * this detail must opt in explicitly via `includeRawDetail`.
 */
export const DEFAULT_SENSITIVE_FIELDS = ["stack", "stackTrace", "rawPayload", "payload", "spanBody", "body"] as const;

export interface TruncatedInfo {
  section: string;
  returned: number;
  total: number;
  how_to_get_more: string;
}

export interface PrunedSection<T> {
  items: T[];
  truncated?: TruncatedInfo;
}

export interface SectionBudgetOptions {
  /** Overrides `DEFAULT_SECTION_CAP` for this section. */
  cap?: number;
  /** Opt-in to keep stack traces, raw payloads, and span bodies instead of dropping them. */
  includeRawDetail?: boolean;
  /** Overrides `DEFAULT_SENSITIVE_FIELDS` for this section. */
  sensitiveFields?: readonly string[];
  /** Overrides the default `how_to_get_more` message builder. */
  howToGetMore?: (section: string, returned: number, total: number) => string;
}

export interface FieldPruneOptions {
  includeRawDetail?: boolean;
  sensitiveFields?: readonly string[];
}

function defaultHowToGetMore(section: string, returned: number, total: number): string {
  return (
    `Only the first ${returned} of ${total} items in "${section}" were returned. ` +
    "Narrow the query (a tighter time window, a filter such as tenantId/userId/status, or a smaller " +
    "`limit`) or page through with the route's `cursor` to see the rest."
  );
}

/**
 * Returns a shallow copy of `record` with sensitive fields (stack traces, raw payloads, span
 * bodies) removed, unless `includeRawDetail` is set. Never mutates the input.
 */
export function pruneSensitiveFields<T extends Record<string, unknown>>(record: T, options: FieldPruneOptions = {}): T {
  if (options.includeRawDetail) {
    return { ...record };
  }

  const fields = options.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS;
  const pruned = { ...record };
  for (const field of fields) {
    delete pruned[field];
  }
  return pruned;
}

/**
 * Applies the response budget to one array-shaped section of a tool response: field-level
 * redaction per item, then a hard cap on item count. When the cap actually drops items, the
 * result carries `truncated` so a downstream consumer knows it saw a cut, not the whole thing.
 */
export function pruneSection<T extends Record<string, unknown>>(
  items: T[],
  section: string,
  options: SectionBudgetOptions = {}
): PrunedSection<T> {
  const cap = options.cap ?? DEFAULT_SECTION_CAP;
  const fieldOptions: FieldPruneOptions = { includeRawDetail: options.includeRawDetail, sensitiveFields: options.sensitiveFields };

  const total = items.length;
  const capped = total > cap ? items.slice(0, cap) : items;
  const prunedItems = capped.map((item) => pruneSensitiveFields(item, fieldOptions));

  if (total <= cap) {
    return { items: prunedItems };
  }

  const howToGetMore = options.howToGetMore ?? defaultHowToGetMore;
  return {
    items: prunedItems,
    truncated: {
      section,
      returned: prunedItems.length,
      total,
      how_to_get_more: howToGetMore(section, prunedItems.length, total)
    }
  };
}
