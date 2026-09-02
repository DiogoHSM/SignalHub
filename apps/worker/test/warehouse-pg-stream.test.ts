import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { OutboundPolicy } from "@sigmon/config";
import * as warehouseExports from "../src/warehouse-exports.js";

describe("warehouse pg stream compatibility", () => {
  it("gives each real pg Client a fresh stream whose positional connect validates the actual DNS answers", async () => {
    const buildConfig = (warehouseExports as unknown as {
      buildWarehousePostgresClientConfig: (input: Record<string, unknown>) => Record<string, unknown>;
    }).buildWarehousePostgresClientConfig;
    expect(typeof buildConfig).toBe("function");

    const lookup = vi.fn((_hostname, options, callback) => {
      expect(options).toMatchObject({ all: true, verbatim: true });
      callback(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.8", family: 4 }
      ] as never);
    });
    const input = {
      connectionUrl: "postgres://writer@warehouse.example/analytics?sslmode=verify-full",
      outboundPolicy: new OutboundPolicy({ nodeEnv: "test" }),
      lookup,
      timeouts: {
        connectionTimeoutMs: 50,
        statementTimeoutMs: 40,
        lockTimeoutMs: 20,
        queryTimeoutMs: 45,
        totalTimeoutMs: 75
      }
    };

    const first = new Client(buildConfig(input));
    const second = new Client(buildConfig(input));
    const firstStream = (first as unknown as { connection: { stream: unknown } }).connection.stream;
    const secondStream = (second as unknown as { connection: { stream: unknown } }).connection.stream;
    expect(firstStream).not.toBe(secondStream);

    await expect(first.connect()).rejects.toMatchObject({ message: "outbound_address_forbidden" });
    expect(lookup).toHaveBeenCalledWith(
      "warehouse.example",
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function)
    );
    await first.end();
    await second.end();
  });

  it("does not inherit ambient pg connection, credential, TLS, or startup settings", async () => {
    const buildConfig = (warehouseExports as unknown as {
      buildWarehousePostgresClientConfig: (input: Record<string, unknown>) => Record<string, unknown>;
    }).buildWarehousePostgresClientConfig;
    const names = [
      "PGUSER",
      "PGPASSWORD",
      "PGHOST",
      "PGPORT",
      "PGDATABASE",
      "PGSSLMODE",
      "PGOPTIONS",
      "PGAPPNAME",
      "PGCLIENT_ENCODING",
      "PGREPLICATION"
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, {
      PGUSER: "ambient-user",
      PGPASSWORD: "ambient-password",
      PGHOST: "127.0.0.1",
      PGPORT: "1",
      PGDATABASE: "ambient-database",
      PGSSLMODE: "no-verify",
      PGOPTIONS: "-c statement_timeout=0",
      PGAPPNAME: "ambient-app",
      PGCLIENT_ENCODING: "SQL_ASCII",
      PGREPLICATION: "database"
    });

    try {
      const client = new Client(buildConfig({
        connectionUrl: "postgres://writer@warehouse.example/analytics",
        outboundPolicy: new OutboundPolicy({ nodeEnv: "test" }),
        timeouts: {
          connectionTimeoutMs: 50,
          statementTimeoutMs: 40,
          lockTimeoutMs: 20,
          queryTimeoutMs: 45,
          totalTimeoutMs: 75
        }
      }));
      const parameters = (client as unknown as { connectionParameters: Record<string, unknown> }).connectionParameters;
      expect(parameters).toMatchObject({
        user: "writer",
        host: "warehouse.example",
        port: 5432,
        database: "analytics",
        ssl: { rejectUnauthorized: true, servername: "warehouse.example" },
        application_name: "sigmon-warehouse-export",
        client_encoding: "UTF8",
        replication: "false",
        options: "-c statement_timeout=40 -c lock_timeout=20 -c idle_in_transaction_session_timeout=75"
      });
      expect(typeof parameters.password).toBe("function");
      await expect((parameters.password as () => Promise<string>)()).resolves.toBe("");
      await client.end();
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
