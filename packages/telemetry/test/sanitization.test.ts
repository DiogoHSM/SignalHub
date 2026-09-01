import { describe, expect, it } from "vitest";
import { sanitizePreviewText, sanitizeValue } from "../src/sanitization.js";

function valueWithContainerDepth(containerLevels: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let depth = 1; depth < containerLevels; depth += 1) value = { child: value };
  return value;
}

function valueWithNodeCount(firstArrayLength: number): Record<string, unknown> {
  return {
    values: Array.from({ length: 512 }, (_, index) => {
      if (index === 0) return Array(firstArrayLength).fill(1);
      if (index < 511) return Array(3).fill(1);
      return [];
    })
  };
}

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

  it("preserves sparse array length and holes in a fresh clone", () => {
    const original: unknown[] = new Array(3);
    original[1] = { password: "secret" };

    const sanitized = sanitizeValue(original) as unknown[];

    expect(sanitized).not.toBe(original);
    expect(sanitized).toHaveLength(3);
    expect(0 in sanitized).toBe(false);
    expect(sanitized[1]).toEqual({ password: "[REDACTED]" });
    expect(2 in sanitized).toBe(false);
  });

  it("rejects a 20,000-level input without overflowing the call stack", () => {
    let value: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) value = { child: value };

    expect(() => sanitizeValue(value)).toThrow("unsafe_recursive_value:depth");
  });

  it("rejects cyclic input", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => sanitizeValue(value)).toThrow("unsafe_recursive_value:cycle");
  });

  it("rejects a ninth container level", () => {
    expect(() => sanitizeValue(valueWithContainerDepth(9))).toThrow("unsafe_recursive_value:depth");
  });

  it("rejects 2,049 nodes", () => {
    expect(() => sanitizeValue(valueWithNodeCount(5))).toThrow("unsafe_recursive_value:nodes");
  });

  it("rejects 513 object keys", () => {
    expect(() => sanitizeValue(Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`key_${index}`, index])))).toThrow(
      "unsafe_recursive_value:keys"
    );
  });

  it("rejects arrays with 513 items", () => {
    expect(() => sanitizeValue({ values: Array(513).fill(1) })).toThrow("unsafe_recursive_value:array_length");
  });

  it("masks sensitive nested keys in ordinary arrays and objects", () => {
    expect(
      sanitizeValue({ nested: { password: "secret" }, values: [{ token: "secret" }, { visible: true }] })
    ).toEqual({
      nested: { password: "[REDACTED]" },
      values: [{ token: "[REDACTED]" }, { visible: true }]
    });
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
      aws_access_key_id: "secret",
      cloud_access_key: "secret",
      s3_secret_access_key: "secret",
      azure_signing_key: "secret",
      private_signing_key: "secret",
      gcp_service_account_key: "secret",
      token_count: 42,
      secretary_name: "visible",
      keynote_title: "visible"
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
      aws_access_key_id: "[REDACTED]",
      cloud_access_key: "[REDACTED]",
      s3_secret_access_key: "[REDACTED]",
      azure_signing_key: "[REDACTED]",
      private_signing_key: "[REDACTED]",
      gcp_service_account_key: "[REDACTED]",
      token_count: 42,
      secretary_name: "visible",
      keynote_title: "visible"
    });
  });

  it("masks high-risk personal and payment identifiers", () => {
    const sanitized = sanitizeValue({
      cpf: "123.456.789-09",
      credit_card: "4111111111111111",
      nested: {
        document: "visible",
        items: [{ creditCard: "5555555555554444" }]
      }
    });

    expect(sanitized).toEqual({
      cpf: "[REDACTED]",
      credit_card: "[REDACTED]",
      nested: {
        document: "visible",
        items: [{ creditCard: "[REDACTED]" }]
      }
    });
  });
});

describe("sanitizePreviewText", () => {
  it("masks credential patterns inside plain preview strings", () => {
    expect(
      sanitizePreviewText(
        "headers authorization: Bearer sh_secret password=super-secret access_token=tok_123 api_key: key_123"
      )
    ).toBe("headers authorization: [REDACTED] password=[REDACTED] access_token=[REDACTED] api_key: [REDACTED]");
  });

  it("preserves ordinary preview text", () => {
    expect(sanitizePreviewText("Summarize dashboard metrics for paid users")).toBe(
      "Summarize dashboard metrics for paid users"
    );
  });
});
