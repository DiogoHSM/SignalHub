import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

describe("loadConfig", () => {
  const validEnv = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a-secure-session-secret-with-enough-length",
    API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple-long-enough",
    GOOGLE_OAUTH_ENABLED: "false"
  };

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

  it("allows blank Google OAuth settings when disabled", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: ""
    });

    expect(config.googleOAuth.enabled).toBe(false);
    expect(config.googleOAuth.redirectUri).toBe("");
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

  it.each([
    ["SESSION_SECRET", "SESSION_SECRET must be at least 32 characters"],
    ["API_KEY_PEPPER", "API_KEY_PEPPER must be at least 32 characters"],
    ["BOOTSTRAP_ADMIN_PASSWORD", "BOOTSTRAP_ADMIN_PASSWORD must be at least 32 characters"]
  ] as const)("rejects weak %s outside test", (secretName, expectedMessage) => {
    expect(() =>
      loadConfig({
        ...validEnv,
        [secretName]: "short"
      })
    ).toThrow(expectedMessage);
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
