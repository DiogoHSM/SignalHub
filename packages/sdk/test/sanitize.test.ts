import { describe, expect, it } from "vitest";
import { enforcePayloadSize, sanitizePayload } from "../src/sanitize.js";

describe("sanitizePayload", () => {
  it("redacts sensitive nested keys while preserving visible fields", () => {
    const payload = {
      metadata: {
        authorization: "Bearer abc123",
        visible: "keep",
        nested: {
          apiKey: "key_123",
          password: "secret",
          count: 3
        }
      },
      name: "checkout"
    };

    expect(sanitizePayload(payload)).toEqual({
      metadata: {
        authorization: "[REDACTED]",
        visible: "keep",
        nested: {
          apiKey: "[REDACTED]",
          password: "[REDACTED]",
          count: 3
        }
      },
      name: "checkout"
    });
  });

  it("redacts credentials embedded in preview strings", () => {
    expect(
      sanitizePayload({
        input_preview: "authorization: Bearer abc123 password=secret",
        output_preview: "api_key: sh_secret"
      })
    ).toEqual({
      input_preview: "authorization: [REDACTED] password=[REDACTED]",
      output_preview: "api_key: [REDACTED]"
    });
  });

  it("truncates strings to the configured length", () => {
    expect(sanitizePayload({ message: "x".repeat(10) }, { maxStringLength: 4 })).toEqual({
      message: "xxxx"
    });
  });

  it("truncates root ingestion fields to schema limits", () => {
    const sanitized = sanitizePayload({
      name: "n".repeat(300),
      provider: "p".repeat(300),
      message: "m".repeat(2_500),
      input_preview: "i".repeat(2_500),
      stack: "s".repeat(21_000),
      metadata: {
        name: "nested names are JSON values and keep the generic limit"
      }
    });

    expect(sanitized.name).toHaveLength(256);
    expect(sanitized.provider).toHaveLength(256);
    expect(sanitized.message).toHaveLength(2_000);
    expect(sanitized.input_preview).toHaveLength(2_000);
    expect(sanitized.stack).toHaveLength(20_000);
    expect((sanitized.metadata as Record<string, string>).name).toBe(
      "nested names are JSON values and keep the generic limit"
    );
  });

  it("replaces circular object references with a stable placeholder", () => {
    const payload: Record<string, unknown> = {
      message: "visible"
    };
    payload.self = payload;

    expect(sanitizePayload(payload)).toEqual({
      message: "visible",
      self: "[Circular]"
    });
  });

  it("replaces circular array references and redacts nested sensitive keys inside arrays", () => {
    const items: unknown[] = [{ apiKey: "key_123", visible: "keep" }];
    items.push(items);

    expect(sanitizePayload({ items })).toEqual({
      items: [{ apiKey: "[REDACTED]", visible: "keep" }, "[Circular]"]
    });
  });

  it("redacts password hash key variants", () => {
    expect(
      sanitizePayload({
        user_password_hash: "hash_1",
        previousPasswordHash: "hash_2",
        visible: "keep"
      })
    ).toEqual({
      user_password_hash: "[REDACTED]",
      previousPasswordHash: "[REDACTED]",
      visible: "keep"
    });
  });
});

describe("enforcePayloadSize", () => {
  it("reports serialized payload byte size and whether it is under the limit", () => {
    expect(enforcePayloadSize({ message: "abcdef" }, 10)).toEqual({ ok: false, bytes: 20 });
    expect(enforcePayloadSize({ message: "abc" }, 100)).toEqual({ ok: true, bytes: 17 });
  });

  it("fails closed for circular payloads, BigInt values, and unserializable top-level values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(enforcePayloadSize(circular, 100)).toEqual({
      ok: false,
      bytes: Number.POSITIVE_INFINITY
    });
    expect(enforcePayloadSize({ value: 1n } as Record<string, unknown>, 100)).toEqual({
      ok: false,
      bytes: Number.POSITIVE_INFINITY
    });
    expect(enforcePayloadSize(undefined as unknown as Record<string, unknown>, 100)).toEqual({
      ok: false,
      bytes: Number.POSITIVE_INFINITY
    });
  });
});
