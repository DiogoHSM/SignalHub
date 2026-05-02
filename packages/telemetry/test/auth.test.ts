import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

describe("password hashing", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    expect(hash).not.toContain("correct-horse-battery-staple");
    await expect(verifyPassword(hash, "correct-horse-battery-staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
