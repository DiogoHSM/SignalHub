import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  createAuthLoginTelemetry,
  hashPassword,
  verifyPassword
} from "../src/auth.js";

describe("password hashing", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    expect(hash).not.toContain("correct-horse-battery-staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct-horse-battery-staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });

  it("uses a different salt for each password hash", async () => {
    const firstHash = await hashPassword("correct-horse-battery-staple");
    const secondHash = await hashPassword("correct-horse-battery-staple");

    expect(firstHash).not.toBe(secondHash);
  });

  it("returns false for malformed hashes", async () => {
    await expect(verifyPassword("not-an-argon2-hash", "password")).resolves.toBe(false);
  });

  it("exports a valid dummy hash that never contains the submitted credential", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(DUMMY_PASSWORD_HASH, "sigmon-dummy-password-never-used-8fB2wP7q")
    ).resolves.toBe(true);
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, "submitted-password")).resolves.toBe(false);
  });
});

describe("authentication telemetry", () => {
  it("emits only an aggregate login outcome", () => {
    const telemetry = createAuthLoginTelemetry("invalid_credentials");

    expect(telemetry).toEqual({ auth: { operation: "login", outcome: "invalid_credentials" } });
    expect(JSON.stringify(telemetry)).not.toMatch(/email|password|hash|token|account/i);
  });
});
