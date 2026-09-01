import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION_CAP, pruneSection, pruneSensitiveFields } from "./budget.js";

function items(count: number): Array<{ id: number; stack?: string; payload?: unknown; spanBody?: unknown }> {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

describe("pruneSection", () => {
  it("passes under-cap input through unpruned with no truncated field", () => {
    const input = items(DEFAULT_SECTION_CAP - 1);
    const result = pruneSection(input, "errors");

    expect(result.items).toEqual(input);
    expect(result.items).toHaveLength(DEFAULT_SECTION_CAP - 1);
    expect(result.truncated).toBeUndefined();
  });

  it("passes exactly-at-cap input through unpruned with no truncated field", () => {
    const input = items(DEFAULT_SECTION_CAP);
    const result = pruneSection(input, "errors");

    expect(result.items).toHaveLength(DEFAULT_SECTION_CAP);
    expect(result.truncated).toBeUndefined();
  });

  it("prunes over-cap input to the cap and carries a correct truncated block", () => {
    const input = items(DEFAULT_SECTION_CAP + 15);
    const result = pruneSection(input, "errors");

    expect(result.items).toHaveLength(DEFAULT_SECTION_CAP);
    expect(result.items).toEqual(input.slice(0, DEFAULT_SECTION_CAP));
    expect(result.truncated).toEqual({
      section: "errors",
      returned: DEFAULT_SECTION_CAP,
      total: DEFAULT_SECTION_CAP + 15,
      how_to_get_more: expect.stringContaining("errors")
    });
  });

  it("honors an explicit cap override", () => {
    const input = items(10);
    const result = pruneSection(input, "traces", { cap: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.truncated).toMatchObject({ section: "traces", returned: 5, total: 10 });
  });

  it("drops stack traces, raw payloads, and span bodies by default", () => {
    const input = [
      { id: 1, stack: "Error: boom\n  at foo", payload: { raw: true }, spanBody: { big: "data" } }
    ];
    const result = pruneSection(input, "errors");

    expect(result.items[0]).not.toHaveProperty("stack");
    expect(result.items[0]).not.toHaveProperty("payload");
    expect(result.items[0]).not.toHaveProperty("spanBody");
    expect(result.items[0]).toMatchObject({ id: 1 });
  });

  it("prunes raw fields when only the tool call opts in", () => {
    expect(pruneSensitiveFields({ stack: "secret" }, { includeRawDetail: true, allowRawDetail: false })).toEqual({});
  });

  it("keeps redacted, budgeted raw fields when both gates opt in", () => {
    const value = pruneSensitiveFields(
      { pageUrl: "https://x.test/?token=abc", stack: "trace" },
      { includeRawDetail: true, allowRawDetail: true }
    );

    expect(value).toEqual({ pageUrl: "https://x.test/?token=%5BREDACTED%5D", stack: "trace" });
  });

  it("keeps stack traces, raw payloads, and span bodies when both gates opt in", () => {
    const input = [
      { id: 1, stack: "Error: boom\n  at foo", payload: { raw: true }, spanBody: { big: "data" } }
    ];
    const result = pruneSection(input, "errors", { includeRawDetail: true, allowRawDetail: true });

    expect(result.items[0]).toMatchObject({
      id: 1,
      stack: "Error: boom\n  at foo",
      payload: { raw: true },
      spanBody: { big: "data" }
    });
  });
});

describe("pruneSensitiveFields", () => {
  it("drops the default sensitive fields from a single record", () => {
    const record = { id: 1, stack: "trace", rawPayload: { a: 1 }, body: "full span body" };
    const pruned = pruneSensitiveFields(record);

    expect(pruned).toEqual({ id: 1 });
  });

  it("leaves sensitive fields intact only when both gates opt in", () => {
    const record = { id: 1, stack: "trace", rawPayload: { a: 1 }, body: "full span body" };
    const pruned = pruneSensitiveFields(record, { includeRawDetail: true, allowRawDetail: true });

    expect(pruned).toEqual(record);
  });

  it("does not mutate the original record", () => {
    const record = { id: 1, stack: "trace" };
    pruneSensitiveFields(record);

    expect(record).toEqual({ id: 1, stack: "trace" });
  });
});
