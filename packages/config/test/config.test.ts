import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

describe("loadConfig", () => {
  it("parses required runtime configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.port).toBe(4000);
    expect(config.googleOAuth.enabled).toBe(false);
  });

  it("rejects weak secrets outside test", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "short",
        API_KEY_PEPPER: "short",
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
        BOOTSTRAP_ADMIN_PASSWORD: "short",
        GOOGLE_OAUTH_ENABLED: "false"
      })
    ).toThrow(/must be at least 32 characters/);
  });

  it("requires Google OAuth settings when enabled", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PORT: "3000",
        DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a-secure-session-secret-with-enough-length",
        API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
        BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
        GOOGLE_OAUTH_ENABLED: "true"
      })
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
