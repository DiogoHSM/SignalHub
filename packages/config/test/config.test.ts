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
  const validGoogleOAuthEnv = {
    ...validEnv,
    GOOGLE_OAUTH_ENABLED: "true",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback"
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

  it("rejects ports above the TCP port range", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        PORT: "99999"
      })
    ).toThrow();
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

  it.each([
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID is required when Google OAuth is enabled"],
    ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET is required when Google OAuth is enabled"],
    ["GOOGLE_REDIRECT_URI", "GOOGLE_REDIRECT_URI is required when Google OAuth is enabled"]
  ] as const)("requires %s when Google OAuth is enabled", (fieldName, expectedMessage) => {
    expect(() =>
      loadConfig({
        ...validGoogleOAuthEnv,
        [fieldName]: ""
      })
    ).toThrow(expectedMessage);
  });
});
