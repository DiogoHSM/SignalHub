import { describe, expect, it } from "vitest";
import { createApiKey, createSourceMapUploadToken, hashApiKey, verifyApiKey } from "../src/api-keys.js";

describe("API keys", () => {
  it("creates prefixed API keys and verifies hashed values", async () => {
    const apiKey = createApiKey();
    const hash = await hashApiKey(apiKey.secret, "pepper-value");

    expect(apiKey.secret).toMatch(/^sh_/);
    expect(apiKey.prefix).toBe(apiKey.secret.slice(0, 12));
    expect(hash).not.toContain(apiKey.secret);
    await expect(verifyApiKey(hash, apiKey.secret, "pepper-value")).resolves.toBe(true);
    await expect(verifyApiKey(hash, apiKey.secret, "wrong-pepper")).resolves.toBe(false);
    await expect(verifyApiKey(hash, "sh_wrong", "pepper-value")).resolves.toBe(false);
  });

  it("creates API keys with the expected shape", () => {
    const apiKey = createApiKey();

    expect(apiKey.secret).toHaveLength(43);
    expect(apiKey.prefix).toHaveLength(12);
    expect(apiKey.secret).toMatch(/^sh_[0-9a-zA-Z]{40}$/);
  });

  it("creates source map upload token secrets", () => {
    const token = createSourceMapUploadToken();

    expect(token.secret).toHaveLength(47);
    expect(token.prefix).toHaveLength(16);
    expect(token.secret).toMatch(/^shsmap_[0-9a-zA-Z]{40}$/);
    expect(token.prefix).toBe(token.secret.slice(0, 16));
  });
});
