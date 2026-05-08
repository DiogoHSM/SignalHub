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

  it("enables console serving explicitly outside production", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "development",
      CONSOLE_ENABLED: "true",
      SIGNALHUB_PUBLIC_ENDPOINT: "https://signalhub.example.com"
    });

    expect(config.console.enabled).toBe(true);
    expect(config.console.publicEndpoint).toBe("https://signalhub.example.com");
  });

  it("loads retention defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.retention).toEqual({
      enabled: true,
      intervalMinutes: 60,
      batchSize: 1000,
      eventsDays: 90,
      errorsDays: 180,
      tracesDays: 90,
      spansDays: 90,
      llmCallsDays: 180
    });
  });

  it("loads explicit retention settings", () => {
    const config = loadConfig({
      ...validEnv,
      RETENTION_ENABLED: "false",
      RETENTION_INTERVAL_MINUTES: "15",
      RETENTION_BATCH_SIZE: "250",
      RETENTION_EVENTS_DAYS: "30",
      RETENTION_ERRORS_DAYS: "60",
      RETENTION_TRACES_DAYS: "30",
      RETENTION_SPANS_DAYS: "15",
      RETENTION_LLM_CALLS_DAYS: "120"
    });

    expect(config.retention).toEqual({
      enabled: false,
      intervalMinutes: 15,
      batchSize: 250,
      eventsDays: 30,
      errorsDays: 60,
      tracesDays: 30,
      spansDays: 15,
      llmCallsDays: 120
    });
  });

  it.each(["RETENTION_INTERVAL_MINUTES", "RETENTION_BATCH_SIZE", "RETENTION_EVENTS_DAYS"] as const)(
    "rejects non-positive %s",
    (fieldName) => {
      expect(() =>
        loadConfig({
          ...validEnv,
          [fieldName]: "0"
        })
      ).toThrow();
    }
  );

  it("loads alert defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.alerts).toEqual({
      enabled: true,
      intervalMinutes: 1,
      webhookTimeoutMs: 5000
    });
  });

  it("loads explicit alert settings", () => {
    const config = loadConfig({
      ...validEnv,
      ALERTS_ENABLED: "false",
      ALERTS_INTERVAL_MINUTES: "5",
      ALERTS_WEBHOOK_TIMEOUT_MS: "2500"
    });

    expect(config.alerts).toEqual({
      enabled: false,
      intervalMinutes: 5,
      webhookTimeoutMs: 2500
    });
  });

  it.each(["ALERTS_INTERVAL_MINUTES", "ALERTS_WEBHOOK_TIMEOUT_MS"] as const)(
    "rejects non-positive %s",
    (fieldName) => {
      expect(() =>
        loadConfig({
          ...validEnv,
          [fieldName]: "0"
        })
      ).toThrow();
    }
  );

  it("loads backup defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.backups).toEqual({
      enabled: true,
      intervalHours: 24,
      localDir: "/var/lib/signalhub/backups",
      retentionDays: 14,
      s3: {
        enabled: false,
        endpoint: "",
        region: "auto",
        bucket: "",
        accessKeyId: "",
        secretAccessKey: "",
        prefix: "signalhub"
      }
    });
  });

  it("loads explicit backup settings", () => {
    const config = loadConfig({
      ...validEnv,
      BACKUPS_ENABLED: "false",
      BACKUPS_INTERVAL_HOURS: "6",
      BACKUPS_LOCAL_DIR: "/tmp/signalhub-backups",
      BACKUPS_RETENTION_DAYS: "7",
      BACKUPS_S3_ENABLED: "true",
      BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BACKUPS_S3_REGION: "auto",
      BACKUPS_S3_BUCKET: "signalhub-backups",
      BACKUPS_S3_ACCESS_KEY_ID: "access-key",
      BACKUPS_S3_SECRET_ACCESS_KEY: "secret-key",
      BACKUPS_S3_PREFIX: "prod/signalhub"
    });

    expect(config.backups).toEqual({
      enabled: false,
      intervalHours: 6,
      localDir: "/tmp/signalhub-backups",
      retentionDays: 7,
      s3: {
        enabled: true,
        endpoint: "https://example.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "signalhub-backups",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        prefix: "prod/signalhub"
      }
    });
  });

  it.each(["BACKUPS_INTERVAL_HOURS", "BACKUPS_RETENTION_DAYS"] as const)("rejects non-positive %s", (fieldName) => {
    expect(() => loadConfig({ ...validEnv, [fieldName]: "0" })).toThrow();
  });

  it("requires S3 settings when backup S3 upload is enabled", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        BACKUPS_S3_ENABLED: "true",
        BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
        BACKUPS_S3_BUCKET: "signalhub-backups",
        BACKUPS_S3_ACCESS_KEY_ID: "access-key"
      })
    ).toThrow("BACKUPS_S3_SECRET_ACCESS_KEY is required when backup S3 upload is enabled");
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

  it.each([
    ["SESSION_SECRET", "change-me-to-a-long-random-secret"],
    ["API_KEY_PEPPER", "change-me-to-a-long-random-pepper"],
    ["BOOTSTRAP_ADMIN_PASSWORD", "change-me-admin-password-32-chars-min"]
  ] as const)("rejects production placeholder %s", (fieldName, placeholder) => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: "production",
        [fieldName]: placeholder
      })
    ).toThrow(`${fieldName} must be replaced for production`);
  });

  it("rejects the local-only Postgres password placeholder in production database URLs", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub"
      })
    ).toThrow("DATABASE_URL uses the local-only Postgres password placeholder");
  });

  it("allows placeholders in test so configuration tests can stay lightweight", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://signalhub:signalhub-local-only-change-me@localhost:5432/signalhub",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "change-me-to-a-long-random-secret",
      API_KEY_PEPPER: "change-me-to-a-long-random-pepper",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin-password-32-chars-min",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.nodeEnv).toBe("test");
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
