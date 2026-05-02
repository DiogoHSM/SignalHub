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
});

describe("enforcePayloadSize", () => {
  it("reports serialized payload byte size and whether it is under the limit", () => {
    expect(enforcePayloadSize({ message: "abcdef" }, 10)).toEqual({ ok: false, bytes: 20 });
    expect(enforcePayloadSize({ message: "abc" }, 100)).toEqual({ ok: true, bytes: 17 });
  });
});
