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

  it("masks common credential key variants conservatively", () => {
    const sanitized = sanitizeValue({
      access_token: "secret",
      refresh_token: "secret",
      client_secret: "secret",
      secret_key: "secret",
      "x-api-key": "secret",
      "set-cookie": "secret",
      password_hash: "secret",
      authToken: "secret",
      token_count: 42,
      secretary_name: "visible"
    });

    expect(sanitized).toEqual({
      access_token: "[REDACTED]",
      refresh_token: "[REDACTED]",
      client_secret: "[REDACTED]",
      secret_key: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "set-cookie": "[REDACTED]",
      password_hash: "[REDACTED]",
      authToken: "[REDACTED]",
      token_count: 42,
      secretary_name: "visible"
    });
  });
});
