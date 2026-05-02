import { describe, expect, it } from "vitest";
import { sanitizeValue } from "../src/sanitization.js";

describe("sanitizeValue", () => {
  it("recursively masks sensitive object keys", () => {
    const sanitized = sanitizeValue({
      email: "user@example.com",
      password: "secret",
      nested: {
        authorization: "Bearer token",
        safe: "visible"
      },
      items: [{ api_key: "abc", count: 1 }]
    });

    expect(sanitized).toEqual({
      email: "user@example.com",
      password: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        safe: "visible"
      },
      items: [{ api_key: "[REDACTED]", count: 1 }]
    });
  });

  it("does not mutate the original object", () => {
    const original = { token: "secret" };
    const sanitized = sanitizeValue(original);

    expect(original.token).toBe("secret");
    expect(sanitized).toEqual({ token: "[REDACTED]" });
  });
});
