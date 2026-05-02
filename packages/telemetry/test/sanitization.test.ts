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
      authorizationHeader: "secret",
      cookieHeader: "secret",
      passwordValue: "secret",
      secretValue: "secret",
      aws_secret_access_key: "secret",
      secret_access_key: "secret",
      access_key: "secret",
      access_key_id: "secret",
      private_key: "secret",
      credential: "secret",
      client_key: "secret",
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
      authorizationHeader: "[REDACTED]",
      cookieHeader: "[REDACTED]",
      passwordValue: "[REDACTED]",
      secretValue: "[REDACTED]",
      aws_secret_access_key: "[REDACTED]",
      secret_access_key: "[REDACTED]",
      access_key: "[REDACTED]",
      access_key_id: "[REDACTED]",
      private_key: "[REDACTED]",
      credential: "[REDACTED]",
      client_key: "[REDACTED]",
      token_count: 42,
      secretary_name: "visible"
    });
  });
});
