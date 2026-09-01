import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { AuthDependencies } from "../routes/auth.js";
import { Argon2Semaphore, LoginGuard, LoginGuardError, createGuardedLogin } from "./login-guard.js";
import { createAuthQuotaRedis } from "./login-redis.js";

const outageDeadlineMs = 750;

async function unavailableRedisUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return `redis://127.0.0.1:${port}`;
}

function expectBounded(startedAt: number): void {
  expect(performance.now() - startedAt).toBeLessThan(outageDeadlineMs);
}

let app: FastifyInstance | undefined;
const adapters: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
});

describe("auth quota Redis outage policy", () => {
  it("rejects an account EVAL within a bounded interval when Redis is unavailable", async () => {
    const adapter = createAuthQuotaRedis(await unavailableRedisUrl(), {
      connectTimeoutMs: 50,
      commandTimeoutMs: 100,
      retryDelayMs: 10
    });
    adapters.push(adapter);
    const guard = new LoginGuard({ sessionSecret: "unit-test-session-secret", redis: adapter });
    const startedAt = performance.now();

    await expect(guard.checkAccount("user@example.com")).rejects.toEqual(new LoginGuardError("auth_unavailable"));
    expectBounded(startedAt);
  });

  it("rejects a success-reset DEL within a bounded interval when Redis is unavailable", async () => {
    const adapter = createAuthQuotaRedis(await unavailableRedisUrl(), {
      connectTimeoutMs: 50,
      commandTimeoutMs: 100,
      retryDelayMs: 10
    });
    adapters.push(adapter);
    const guard = new LoginGuard({ sessionSecret: "unit-test-session-secret", redis: adapter });
    const startedAt = performance.now();

    await expect(guard.recordSuccess("user@example.com")).rejects.toEqual(new LoginGuardError("auth_unavailable"));
    expectBounded(startedAt);
  });

  it("returns the planned 503 login response within the outage deadline", async () => {
    const adapter = createAuthQuotaRedis(await unavailableRedisUrl(), {
      connectTimeoutMs: 50,
      commandTimeoutMs: 100,
      retryDelayMs: 10
    });
    adapters.push(adapter);
    const guard = new LoginGuard({ sessionSecret: "unit-test-session-secret", redis: adapter });
    const auth = {
      loginGuard: guard,
      login: createGuardedLogin({
        guard,
        semaphore: new Argon2Semaphore(1),
        findUser: async () => undefined,
        verifyPassword: async () => false,
        createSession: async () => undefined
      }),
      findSessionUser: async () => null
    } satisfies AuthDependencies;
    app = await buildApp({ readiness: async () => ({ postgres: true, redis: false }), auth });
    const startedAt = performance.now();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "user@example.com", password: "submitted" }
    });

    expectBounded(startedAt);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "auth_unavailable" });
  });
});
