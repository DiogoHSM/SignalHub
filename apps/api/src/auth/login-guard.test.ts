import { describe, expect, it, vi } from "vitest";
import { Argon2Semaphore, LoginGuard, LoginGuardError } from "./login-guard.js";

function createRedisQuotaFake() {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const calls: Array<{ script: string; key: string; ttlMs: string }> = [];
  let now = 1_000;

  return {
    calls,
    counts,
    expiries,
    advance(milliseconds: number) {
      now += milliseconds;
    },
    redis: {
      eval: async (script: string, numberOfKeys: number, key: string, ttlMs: string) => {
        expect(numberOfKeys).toBe(1);
        calls.push({ script, key, ttlMs });
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count === 1) expiries.set(key, now + Number(ttlMs));
        return count;
      },
      del: async (key: string) => {
        counts.delete(key);
        expiries.delete(key);
        return 1;
      }
    }
  };
}

describe("LoginGuard", () => {
  it("uses the Fastify source quota result and rejects an exceeded trusted-IP bucket", async () => {
    const fake = createRedisQuotaFake();
    const guard = new LoginGuard({ sessionSecret: "unit-test-session-secret", redis: fake.redis });

    await expect(
      guard.checkSource(async () => ({ isAllowed: false, key: "127.0.0.1", isExceeded: false }))
    ).resolves.toBeUndefined();
    await expect(
      guard.checkSource(async () => ({ isAllowed: false, key: "127.0.0.1", isExceeded: true }))
    ).rejects.toMatchObject({ code: "source_rate_limited" });
  });

  it("uses one atomic Redis evaluation to increment and apply only the first expiry", async () => {
    const fake = createRedisQuotaFake();
    const guard = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: fake.redis,
      accountWindowMs: 900_000
    });

    await guard.checkAccount("Mixed@Example.com ");
    const key = "auth:login:account:df6dae2ebd059fc50aac6f7d48338c0fb2fb85c3b8849df98edf62ece9a074db";
    const firstExpiry = fake.expiries.get(key);
    fake.advance(50_000);
    await guard.checkAccount(" mixed@example.com");

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({ key, ttlMs: "900000" });
    expect(fake.calls[0]?.script.replace(/\s+/g, " ").trim()).toBe(
      'local count = redis.call("INCR", KEYS[1]) if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end return count'
    );
    expect(fake.expiries.get(key)).toBe(firstExpiry);
  });

  it("enforces the normalized-account quota without exposing the account in the key", async () => {
    const fake = createRedisQuotaFake();
    const guard = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: fake.redis,
      accountLimit: 2
    });

    await guard.checkAccount("USER@example.com");
    await guard.checkAccount(" user@EXAMPLE.com ");

    await expect(guard.checkAccount("user@example.com")).rejects.toMatchObject({ code: "account_rate_limited" });
    expect(fake.calls.map((call) => call.key)).toEqual([
      fake.calls[0]?.key,
      fake.calls[0]?.key,
      fake.calls[0]?.key
    ]);
    expect(fake.calls[0]?.key).not.toContain("user@example.com");
  });

  it("fails closed when Redis rejects or returns a malformed counter", async () => {
    const unavailable = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: {
        eval: async () => {
          throw new Error("redis unavailable");
        },
        del: async () => 1
      }
    });
    const malformed = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: { eval: async () => "not-a-counter", del: async () => 1 }
    });

    await expect(unavailable.checkAccount("user@example.com")).rejects.toEqual(
      new LoginGuardError("auth_unavailable")
    );
    await expect(malformed.checkAccount("user@example.com")).rejects.toEqual(
      new LoginGuardError("auth_unavailable")
    );
  });

  it("clears a successful account counter and fails closed when clearing is unavailable", async () => {
    const fake = createRedisQuotaFake();
    const guard = new LoginGuard({ sessionSecret: "unit-test-session-secret", redis: fake.redis });
    await guard.checkAccount("user@example.com");

    await guard.recordSuccess(" USER@example.com ");
    expect(fake.counts.size).toBe(0);

    const unavailable = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: { eval: async () => 1, del: async () => Promise.reject(new Error("redis unavailable")) }
    });
    await expect(unavailable.recordSuccess("user@example.com")).rejects.toMatchObject({ code: "auth_unavailable" });
  });

  it("applies an injected progressive delay and caps it", async () => {
    const fake = createRedisQuotaFake();
    const delay = vi.fn(async () => undefined);
    const guard = new LoginGuard({
      sessionSecret: "unit-test-session-secret",
      redis: fake.redis,
      delay,
      progressiveDelayMaxMs: 2_000
    });

    await guard.recordFailure(1);
    await guard.recordFailure(2);
    await guard.recordFailure(8);

    expect(delay.mock.calls).toEqual([[100], [200], [2_000]]);
  });
});

describe("Argon2Semaphore", () => {
  it("limits concurrency and admits queued work in FIFO order", async () => {
    const semaphore = new Argon2Semaphore(2);
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const operations = [1, 2, 3, 4].map((number) =>
      semaphore.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(number);
            releases[number - 1] = () => resolve(number);
          })
      )
    );

    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    releases[1]?.();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    releases[0]?.();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3, 4]));
    releases[2]?.();
    releases[3]?.();

    await expect(Promise.all(operations)).resolves.toEqual([1, 2, 3, 4]);
  });

  it("releases a permit when an operation rejects", async () => {
    const semaphore = new Argon2Semaphore(1);
    const second = vi.fn(async () => "second");

    await expect(semaphore.run(async () => Promise.reject(new Error("argon2 rejected")))).rejects.toThrow(
      "argon2 rejected"
    );
    await expect(semaphore.run(second)).resolves.toBe("second");
    expect(second).toHaveBeenCalledOnce();
  });

  it("rejects a non-positive concurrency limit", () => {
    expect(() => new Argon2Semaphore(0)).toThrow("argon2_concurrency_limit_invalid");
  });
});
