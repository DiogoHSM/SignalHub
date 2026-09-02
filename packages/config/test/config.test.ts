import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

describe("loadConfig", () => {
  const currentDataEncryptionKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
  const previousDataEncryptionKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";

  it("loads login abuse-control defaults", () => {
    expect(loadConfig(baseEnv()).auth.login).toEqual({
      sourceMaxAttempts: 10,
      sourceWindowMs: 60_000,
      accountMaxAttempts: 8,
      accountWindowMs: 15 * 60_000,
      argon2Concurrency: 4,
      progressiveDelayMaxMs: 2_000
    });
  });

  it("loads and validates explicit login abuse-control settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      LOGIN_SOURCE_MAX_ATTEMPTS: "12",
      LOGIN_SOURCE_WINDOW_MS: "30000",
      LOGIN_ACCOUNT_MAX_ATTEMPTS: "6",
      LOGIN_ACCOUNT_WINDOW_MS: "600000",
      LOGIN_ARGON2_CONCURRENCY: "2",
      LOGIN_PROGRESSIVE_DELAY_MAX_MS: "1500"
    });

    expect(config.auth.login).toEqual({
      sourceMaxAttempts: 12,
      sourceWindowMs: 30_000,
      accountMaxAttempts: 6,
      accountWindowMs: 600_000,
      argon2Concurrency: 2,
      progressiveDelayMaxMs: 1_500
    });
  });

  it.each([
    "LOGIN_SOURCE_MAX_ATTEMPTS",
    "LOGIN_SOURCE_WINDOW_MS",
    "LOGIN_ACCOUNT_MAX_ATTEMPTS",
    "LOGIN_ACCOUNT_WINDOW_MS",
    "LOGIN_ARGON2_CONCURRENCY",
    "LOGIN_PROGRESSIVE_DELAY_MAX_MS"
  ] as const)("rejects non-positive %s", (fieldName) => {
    expect(() => loadConfig({ ...baseEnv(), [fieldName]: "0" })).toThrow();
  });

  const validEnv = {
    NODE_ENV: "production",
    PORT: "3000",
    DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "a-secure-session-secret-with-enough-length",
    API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
    DATA_ENCRYPTION_KEY: currentDataEncryptionKey,
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
  const baseEnv = () => ({ ...validEnv });

  it("loads the current and previous data-encryption keys", () => {
    const config = loadConfig({
      ...baseEnv(),
      DATA_ENCRYPTION_KEY_PREVIOUS: previousDataEncryptionKey
    });

    expect(config.dataEncryption).toEqual({
      currentKey: currentDataEncryptionKey,
      previousKey: previousDataEncryptionKey
    });
  });

  it("allows data-encryption keys to be omitted outside production", () => {
    const config = loadConfig({
      ...baseEnv(),
      NODE_ENV: "test",
      DATA_ENCRYPTION_KEY: undefined
    });

    expect(config.dataEncryption).toEqual({ currentKey: undefined, previousKey: undefined });
  });

  it("requires the current data-encryption key in production", () => {
    expect(() => loadConfig({ ...baseEnv(), DATA_ENCRYPTION_KEY: undefined })).toThrow(
      "DATA_ENCRYPTION_KEY is required in production"
    );
  });

  it.each([
    ["invalid base64", "not-base64!"],
    ["noncanonical base64", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"],
    ["short", Buffer.alloc(31, 1).toString("base64")],
    ["long", Buffer.alloc(33, 1).toString("base64")]
  ])("rejects an %s current data-encryption key", (_label, value) => {
    expect(() => loadConfig({ ...baseEnv(), DATA_ENCRYPTION_KEY: value })).toThrow(
      "DATA_ENCRYPTION_KEY_invalid"
    );
  });

  it("rejects an invalid previous data-encryption key", () => {
    expect(() => loadConfig({ ...baseEnv(), DATA_ENCRYPTION_KEY_PREVIOUS: "not-base64!" })).toThrow(
      "DATA_ENCRYPTION_KEY_PREVIOUS_invalid"
    );
  });

  it("rejects a previous data-encryption key without a current key", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        NODE_ENV: "test",
        DATA_ENCRYPTION_KEY: undefined,
        DATA_ENCRYPTION_KEY_PREVIOUS: previousDataEncryptionKey
      })
    ).toThrow("DATA_ENCRYPTION_KEY is required when DATA_ENCRYPTION_KEY_PREVIOUS is set");
  });

  it("rejects equal current and previous data-encryption key material", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        DATA_ENCRYPTION_KEY_PREVIOUS: currentDataEncryptionKey
      })
    ).toThrow("DATA_ENCRYPTION_KEY_PREVIOUS_must_differ");
  });

  it("parses required runtime configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a-secure-session-secret-with-enough-length",
      API_KEY_PEPPER: "a-secure-api-key-pepper-with-enough-length",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ADMIN_PASSWORD: "correct-horse-battery-staple",
      GOOGLE_OAUTH_ENABLED: "false"
    });

    expect(config.port).toBe(4000);
    expect(config.googleOAuth.enabled).toBe(false);
    expect(config.worker.role).toBe("all");
    expect(config.mcp.allowRawDetail).toBe(false);
  });

  it("requires an explicit true value to authorize MCP raw detail", () => {
    expect(loadConfig({ ...validEnv, MCP_ALLOW_RAW_DETAIL: "true" }).mcp.allowRawDetail).toBe(true);
  });

  it.each(["all", "queue", "scheduler"] as const)("loads worker role %s", (role) => {
    const config = loadConfig({
      ...baseEnv(),
      WORKER_ROLE: role
    });

    expect(config.worker.role).toBe(role);
  });

  it("enables console serving explicitly outside production", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "development",
      CONSOLE_ENABLED: "true",
      SIGMON_PUBLIC_ENDPOINT: "https://sigmon.example.com"
    });

    expect(config.console.enabled).toBe(true);
    expect(config.console.publicEndpoint).toBe("https://sigmon.example.com");
  });

  it("loads browser CORS origins for cross-origin SDK ingestion", () => {
    const config = loadConfig({
      ...validEnv,
      BROWSER_CORS_ORIGINS: "https://app.controledaempresa.com, https://microerp.example.com/"
    });

    expect(config.browserCors.origins).toEqual([
      "https://app.controledaempresa.com",
      "https://microerp.example.com"
    ]);
  });

  it("defaults trusted proxy CIDRs to an empty list", () => {
    expect(loadConfig(baseEnv()).trustedProxyCidrs).toEqual([]);
  });

  it("loads literal trusted proxy addresses and CIDRs in configured order", () => {
    const config = loadConfig({
      ...baseEnv(),
      TRUSTED_PROXY_CIDRS: " 10.0.0.4/32, fd00::4/128, 192.0.2.10, 2001:db8::10 "
    });

    expect(config.trustedProxyCidrs).toEqual([
      "10.0.0.4/32",
      "fd00::4/128",
      "192.0.2.10",
      "2001:db8::10"
    ]);
  });

  it.each([
    "true",
    "false",
    "1",
    "10.0.0.0/33",
    "fd00::/129",
    "10.0.0.1/not-a-prefix",
    "proxy.internal",
    "10.0.0.1,,10.0.0.2"
  ])("rejects malformed trusted proxy entry %s", (entry) => {
    expect(() => loadConfig({ ...baseEnv(), TRUSTED_PROXY_CIDRS: entry })).toThrow(
      "trusted_proxy_invalid"
    );
  });

  it.each(["0.0.0.0/0", "::/0", "10.0.0.1/0", "2001:db8::1/0"])(
    "rejects production trust-all CIDR %s",
    (entry) => {
      expect(() => loadConfig({ ...baseEnv(), TRUSTED_PROXY_CIDRS: entry })).toThrow(
        "trusted_proxy_too_broad"
      );
    }
  );

  it.each([
    "::ffff:0:0/96",
    "0:0:0:0:0:ffff:0:0/96",
    "::ffff:0.0.0.0/96",
    "::fffe:0:0/95",
    "::/80"
  ])("rejects production CIDR %s that trusts every mapped IPv4 peer", (entry) => {
    expect(() => loadConfig({ ...baseEnv(), TRUSTED_PROXY_CIDRS: entry })).toThrow(
      "trusted_proxy_too_broad"
    );
  });

  it.each(["::ffff:0:0/97", "::ffff:192.0.2.0/120"])(
    "allows narrower production mapped-IPv4 proxy CIDR %s",
    (entry) => {
      expect(loadConfig({ ...baseEnv(), TRUSTED_PROXY_CIDRS: entry }).trustedProxyCidrs).toEqual([
        entry
      ]);
    }
  );

  it("loads retention defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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
      llmCallsDays: 180,
      profilesDays: 30,
      breadcrumbsDays: 30,
      deadLetterJobsDays: 30
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
      RETENTION_LLM_CALLS_DAYS: "120",
      RETENTION_DEAD_LETTER_JOBS_DAYS: "45"
    });

    expect(config.retention).toEqual({
      enabled: false,
      intervalMinutes: 15,
      batchSize: 250,
      eventsDays: 30,
      errorsDays: 60,
      tracesDays: 30,
      spansDays: 15,
      llmCallsDays: 120,
      profilesDays: 30,
      breadcrumbsDays: 30,
      deadLetterJobsDays: 45
    });
  });

  it("loads event rollup defaults and overrides", () => {
    const defaults = loadConfig(baseEnv());
    expect(defaults.eventRollups).toEqual({
      enabled: true,
      intervalMinutes: 60,
      lookbackDays: 400
    });

    const custom = loadConfig({
      ...validEnv,
      EVENT_ROLLUPS_ENABLED: "false",
      EVENT_ROLLUPS_INTERVAL_MINUTES: "30",
      EVENT_ROLLUPS_LOOKBACK_DAYS: "200"
    });
    expect(custom.eventRollups).toEqual({
      enabled: false,
      intervalMinutes: 30,
      lookbackDays: 200
    });
  });

  it("loads breadcrumb retention config with defaults and overrides", () => {
    const defaults = loadConfig(baseEnv());
    expect(defaults.retention.breadcrumbsDays).toBe(30);
    expect(defaults.retention.deadLetterJobsDays).toBe(30);

    const custom = loadConfig({ ...baseEnv(), RETENTION_BREADCRUMBS_DAYS: "14", RETENTION_DEAD_LETTER_JOBS_DAYS: "21" });
    expect(custom.retention.breadcrumbsDays).toBe(14);
    expect(custom.retention.deadLetterJobsDays).toBe(21);
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
      DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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

  it("loads monitor scheduler defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.monitors).toEqual({
      enabled: true,
      intervalMinutes: 1,
      httpTimeoutMs: 5000,
      maxConcurrency: 5
    });
  });

  it("loads explicit monitor scheduler settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      MONITORS_ENABLED: "false",
      MONITORS_INTERVAL_MINUTES: "2",
      MONITORS_HTTP_TIMEOUT_MS: "2500",
      MONITORS_MAX_CONCURRENCY: "3"
    });

    expect(config.monitors).toEqual({
      enabled: false,
      intervalMinutes: 2,
      httpTimeoutMs: 2500,
      maxConcurrency: 3
    });
  });

  it.each(["MONITORS_INTERVAL_MINUTES", "MONITORS_HTTP_TIMEOUT_MS", "MONITORS_MAX_CONCURRENCY"] as const)(
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

  it("loads SMTP config for email alert delivery", () => {
    const config = loadConfig({
      ...baseEnv(),
      SMTP_HOST: "smtp.resend.com",
      SMTP_PORT: "587",
      SMTP_USERNAME: "resend",
      SMTP_PASSWORD: "secret-password",
      SMTP_FROM: "Sigmon <alerts@sigmon.app>",
      SMTP_SECURE: "false"
    });

    expect(config.smtp).toEqual({
      enabled: true,
      host: "smtp.resend.com",
      port: 587,
      username: "resend",
      password: "secret-password",
      from: "Sigmon <alerts@sigmon.app>",
      secure: false
    });
  });

  it("keeps SMTP disabled when host and from are absent", () => {
    expect(loadConfig(baseEnv()).smtp.enabled).toBe(false);
    expect(loadConfig({ ...baseEnv(), SMTP_PORT: "587", SMTP_SECURE: "false" }).smtp.enabled).toBe(false);
  });

  it("requires full SMTP settings when any SMTP option is present", () => {
    expect(() => loadConfig({ ...baseEnv(), SMTP_SECURE: "true" })).toThrow(
      "SMTP_HOST is required when SMTP email is enabled"
    );
    expect(() => loadConfig({ ...baseEnv(), SMTP_PORT: "2525" })).toThrow(
      "SMTP_HOST is required when SMTP email is enabled"
    );
    expect(() => loadConfig({ ...baseEnv(), SMTP_HOST: "   " })).not.toThrow();
    expect(loadConfig({ ...baseEnv(), SMTP_HOST: "   " }).smtp.enabled).toBe(false);
  });

  it("loads backup defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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
      localDir: "/var/lib/sigmon/backups",
      retentionDays: 14,
      s3: {
        enabled: false,
        endpoint: "",
        region: "auto",
        bucket: "",
        accessKeyId: "",
        secretAccessKey: "",
        prefix: "sigmon"
      }
    });
  });

  it("loads explicit backup settings", () => {
    const config = loadConfig({
      ...validEnv,
      BACKUPS_ENABLED: "false",
      BACKUPS_INTERVAL_HOURS: "6",
      BACKUPS_LOCAL_DIR: "/tmp/sigmon-backups",
      BACKUPS_RETENTION_DAYS: "7",
      BACKUPS_S3_ENABLED: "true",
      BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BACKUPS_S3_REGION: "auto",
      BACKUPS_S3_BUCKET: "sigmon-backups",
      BACKUPS_S3_ACCESS_KEY_ID: "access-key",
      BACKUPS_S3_SECRET_ACCESS_KEY: "secret-key",
      BACKUPS_S3_PREFIX: "prod/sigmon"
    });

    expect(config.backups).toEqual({
      enabled: false,
      intervalHours: 6,
      localDir: "/tmp/sigmon-backups",
      retentionDays: 7,
      s3: {
        enabled: true,
        endpoint: "https://example.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "sigmon-backups",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        prefix: "prod/sigmon"
      }
    });
  });

  it.each(["BACKUPS_INTERVAL_HOURS", "BACKUPS_RETENTION_DAYS"] as const)("rejects non-positive %s", (fieldName) => {
    expect(() => loadConfig({ ...validEnv, [fieldName]: "0" })).toThrow();
  });

  it("loads source map storage config with defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.sourceMaps).toEqual({
      localDir: "/var/lib/sigmon/source-maps",
      maxUploadMb: 50,
      retention: {
        enabled: true,
        days: 180,
        batchSize: 100
      }
    });
  });

  it("loads custom source map storage config", () => {
    const config = loadConfig({
      ...baseEnv(),
      SOURCE_MAPS_LOCAL_DIR: "/tmp/sigmon-source-maps",
      SOURCE_MAPS_MAX_UPLOAD_MB: "12"
    });

    expect(config.sourceMaps).toEqual({
      localDir: "/tmp/sigmon-source-maps",
      maxUploadMb: 12,
      retention: {
        enabled: true,
        days: 180,
        batchSize: 100
      }
    });
  });

  it("loads source-map retention defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.sourceMaps.retention).toEqual({
      enabled: true,
      days: 180,
      batchSize: 100
    });
  });

  it("loads explicit source-map retention settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      SOURCE_MAPS_RETENTION_ENABLED: "false",
      SOURCE_MAPS_RETENTION_DAYS: "45",
      SOURCE_MAPS_RETENTION_BATCH_SIZE: "25"
    });

    expect(config.sourceMaps.retention).toEqual({
      enabled: false,
      days: 45,
      batchSize: 25
    });
  });

  it.each(["SOURCE_MAPS_RETENTION_DAYS", "SOURCE_MAPS_RETENTION_BATCH_SIZE"] as const)(
    "rejects non-positive %s",
    (fieldName) => {
      expect(() => loadConfig({ ...baseEnv(), [fieldName]: "0" })).toThrow();
    }
  );

  it("loads system health history defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.systemHealthHistory).toEqual({
      enabled: true,
      sampleIntervalMinutes: 5,
      retentionHours: 48
    });
  });

  it("loads explicit system health history settings", () => {
    const config = loadConfig({
      ...baseEnv(),
      SYSTEM_HEALTH_HISTORY_ENABLED: "false",
      SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES: "10",
      SYSTEM_HEALTH_HISTORY_RETENTION_HOURS: "72"
    });

    expect(config.systemHealthHistory).toEqual({
      enabled: false,
      sampleIntervalMinutes: 10,
      retentionHours: 72
    });
  });

  it.each(["SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES", "SYSTEM_HEALTH_HISTORY_RETENTION_HOURS"] as const)(
    "rejects non-positive %s",
    (fieldName) => {
      expect(() => loadConfig({ ...validEnv, [fieldName]: "0" })).toThrow();
    }
  );

  it("loads PER-449 db statement timeout and funnel actor cap defaults", () => {
    const config = loadConfig(baseEnv());

    expect(config.db).toEqual({
      statementTimeoutMs: 15_000,
      workerStatementTimeoutMs: 0
    });
    expect(config.funnel).toEqual({ maxActors: 50_000 });
  });

  it("loads explicit db statement timeout and funnel actor cap settings, allowing 0 to disable", () => {
    const config = loadConfig({
      ...baseEnv(),
      DB_STATEMENT_TIMEOUT_MS: "0",
      DB_WORKER_STATEMENT_TIMEOUT_MS: "30000",
      FUNNEL_MAX_ACTORS: "1000"
    });

    expect(config.db).toEqual({
      statementTimeoutMs: 0,
      workerStatementTimeoutMs: 30_000
    });
    expect(config.funnel).toEqual({ maxActors: 1000 });
  });

  it.each(["DB_STATEMENT_TIMEOUT_MS", "DB_WORKER_STATEMENT_TIMEOUT_MS", "FUNNEL_MAX_ACTORS"] as const)(
    "rejects a negative %s",
    (fieldName) => {
      expect(() => loadConfig({ ...baseEnv(), [fieldName]: "-1" })).toThrow();
    }
  );

  it("requires S3 settings when backup S3 upload is enabled", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        BACKUPS_S3_ENABLED: "true",
        BACKUPS_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
        BACKUPS_S3_BUCKET: "sigmon-backups",
        BACKUPS_S3_ACCESS_KEY_ID: "access-key"
      })
    ).toThrow("BACKUPS_S3_SECRET_ACCESS_KEY is required when backup S3 upload is enabled");
  });

  it("allows blank Google OAuth settings when disabled", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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
        DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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
        DATABASE_URL: "postgres://sigmon:sigmon-local-only-change-me@localhost:5432/sigmon"
      })
    ).toThrow("DATABASE_URL uses the local-only Postgres password placeholder");
  });

  it("rejects the percent-encoded local-only Postgres password placeholder in production database URLs", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://sigmon:sigmon%2Dlocal%2Donly%2Dchange%2Dme@localhost:5432/sigmon"
      })
    ).toThrow("DATABASE_URL uses the local-only Postgres password placeholder");
  });

  it("allows placeholders in test so configuration tests can stay lightweight", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://sigmon:sigmon-local-only-change-me@localhost:5432/sigmon",
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
        DATABASE_URL: "postgres://user:pass@localhost:5432/sigmon",
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
