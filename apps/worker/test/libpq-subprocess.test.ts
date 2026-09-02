import { describe, expect, it } from "vitest";
import { buildLibpqSubprocess } from "../src/libpq-subprocess.js";

describe("buildLibpqSubprocess", () => {
  it("moves every supported connection field into a scrubbed child environment", () => {
    const descriptor = buildLibpqSubprocess(
      "postgres://alice:p%40ss@db.test:5432/sigmon?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem&sslcert=%2Fcerts%2Fclient.pem&sslkey=%2Fcerts%2Fclient.key&connect_timeout=30&application_name=sigmon%20backup",
      {
        PATH: "C:/PostgreSQL/bin",
        NODE_ENV: "test",
        PGPASSWORD: "ambient-password",
        pgservice: "ambient-service",
        PgOptions: "ambient-options",
        PGHOSTADDR: "203.0.113.7",
        pgpassfile: "C:/ambient.pgpass"
      }
    );

    expect(descriptor).toEqual({
      argsConnection: "dbname='sigmon'",
      safeLabel: "db.test:5432/sigmon",
      env: {
        PATH: "C:/PostgreSQL/bin",
        NODE_ENV: "test",
        PGHOST: "db.test",
        PGPORT: "5432",
        PGUSER: "alice",
        PGPASSWORD: "p@ss",
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "/certs/root.pem",
        PGSSLCERT: "/certs/client.pem",
        PGSSLKEY: "/certs/client.key",
        PGCONNECT_TIMEOUT: "30",
        PGAPPNAME: "sigmon backup"
      }
    });
  });

  it("removes every case variant of inherited PG variables while preserving non-PG runtime variables", () => {
    const descriptor = buildLibpqSubprocess("postgresql://db.test/sigmon", {
      PATH: "C:/PostgreSQL/bin",
      SystemRoot: "C:/Windows",
      pghost: "attacker.test",
      PgPassword: "ambient-password",
      PGSERVICE: "ambient-service",
      pgoptions: "-c search_path=attacker",
      PGHOSTADDR: "203.0.113.10",
      PgPassFile: "C:/ambient.pgpass",
      PGSSLKEY: "C:/ambient.key",
      PGLOCALEDIR: "C:/ambient-locale"
    });

    expect(descriptor.env.PATH).toBe("C:/PostgreSQL/bin");
    expect(descriptor.env.SystemRoot).toBe("C:/Windows");
    expect(Object.keys(descriptor.env).filter((key) => /^pg/i.test(key))).toEqual(["PGHOST"]);
    expect(descriptor.env.PGHOST).toBe("db.test");
  });

  it("supports bracketed IPv6 and escapes the database as one keyword conninfo value", () => {
    const descriptor = buildLibpqSubprocess(
      "postgresql://u%2525:p%2540@[2001:db8::1]:5433/a%27b%5Cc%3Dd%3A%2F%2Fx",
      {}
    );

    expect(descriptor.argsConnection).toBe("dbname='a\\'b\\\\c=d://x'");
    expect(descriptor.env).toEqual({
      PGHOST: "2001:db8::1",
      PGPORT: "5433",
      PGUSER: "u%25",
      PGPASSWORD: "p%40"
    });
    expect(descriptor.safeLabel).toBe("[2001:db8::1]:5433/a'b\\c=d://x");
  });

  it("supports an explicitly percent-encoded Unix-domain socket host", () => {
    const descriptor = buildLibpqSubprocess(
      "postgresql://socket_user:socket_pass@%2Fvar%2Frun%2Fpostgresql/sigmon",
      { PATH: "/usr/bin" }
    );

    expect(descriptor.argsConnection).toBe("dbname='sigmon'");
    expect(descriptor.env).toEqual({
      PATH: "/usr/bin",
      PGHOST: "/var/run/postgresql",
      PGUSER: "socket_user",
      PGPASSWORD: "socket_pass"
    });
    expect(descriptor.safeLabel).toBe("/var/run/postgresql/sigmon");
  });

  it("decodes each component exactly once and keeps a URI-like database inside dbname", () => {
    const descriptor = buildLibpqSubprocess(
      "postgres://u%2525:p%252540@db.test/%70ostgres%3A%2F%2Fsecret%40example%252Fdb",
      {}
    );

    expect(descriptor.argsConnection).toBe("dbname='postgres://secret@example%2Fdb'");
    expect(descriptor.env.PGUSER).toBe("u%25");
    expect(descriptor.env.PGPASSWORD).toBe("p%2540");
  });

  it.each([
    "http://user:pass@db.test/sigmon",
    "postgres:db.test/sigmon",
    "postgres://db.test/sigmon#",
    "postgres://db.test/sigmon#section",
    "postgres://db.test/sigmon?target_session_attrs=read-write",
    "postgres://db.test/sigmon?password=secret",
    "postgres://db.test/sigmon?token=secret",
    "postgres://db.test/sigmon?credential=secret",
    "postgres://db.test/sigmon?sslmode=require&sslmode=verify-full",
    "postgres://db.test/sigmon?ssl%6dode=require",
    "postgres://db.test/sigmon?SSLmode=require",
    "postgres://db.test/sigmon?sslmode=invalid",
    "postgres://db.test/sigmon?connect_timeout=0",
    "postgres://db.test/sigmon?connect_timeout=-1",
    "postgres://db.test/sigmon?connect_timeout=%2B1",
    "postgres://db.test/sigmon?connect_timeout=01",
    "postgres://db.test/sigmon?connect_timeout=301",
    "postgres://db.test/sigmon?connect_timeout=999999999999999999999999",
    "postgres://db.test/sigmon?connect_timeout=1.5",
    "postgres://user:p%ZZ@db.test/sigmon",
    "postgres://db.test/sig%ZZmon",
    "postgres://db.test/sigmon?application_name=%ZZ",
    "postgres://db.test/sigmon?application_name=bad%00name",
    "postgres://user%00name:pass@db.test/sigmon",
    "postgres://user:pass%00word@db.test/sigmon",
    "postgres://db.test/sig%00mon",
    "postgres://db.test/",
    "postgres://db.test",
    "postgres:///sigmon",
    "postgres://db-a.test,db-b.test/sigmon",
    "postgres://db-a.test%2Cdb-b.test/sigmon",
    "postgres://db.test:/sigmon",
    "postgres://db.test:0/sigmon",
    "postgres://db.test:65536/sigmon",
    "postgres://db.test:not-a-port/sigmon",
    "postgres://%2Fvar%2Frun%2Fpostgresql:5432/sigmon",
    "postgres://%2E%2E%2Fsocket/sigmon"
  ])("rejects ambiguous or unsupported database URL %s with one stable error", (databaseUrl) => {
    expect(() => buildLibpqSubprocess(databaseUrl, {})).toThrow("database_url_invalid");
  });

  it.each(["1", "300"])("accepts the connect_timeout boundary %s", (connectTimeout) => {
    expect(
      buildLibpqSubprocess(`postgres://db.test/sigmon?connect_timeout=${connectTimeout}`, {}).env
        .PGCONNECT_TIMEOUT
    ).toBe(connectTimeout);
  });
});
