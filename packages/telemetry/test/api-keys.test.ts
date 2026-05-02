import { describe, expect, it } from "vitest";
import { createApiKey, hashApiKey, verifyApiKey } from "../src/api-keys.js";

describe("API keys", () => {
  it("creates prefixed API keys and verifies hashed values", async () => {
    const apiKey = createApiKey();
    const hash = await hashApiKey(apiKey.secret, "pepper-value");

    expect(apiKey.secret).toMatch(/^sh_/);
    expect(apiKey.prefix).toBe(apiKey.secret.slice(0, 12));
    expect(hash).not.toContain(apiKey.secret);
    await expect(verifyApiKey(hash, apiKey.secret, "pepper-value")).resolves.toBe(true);
    await expect(verifyApiKey(hash, "sh_wrong", "pepper-value")).resolves.toBe(false);
  });
});
