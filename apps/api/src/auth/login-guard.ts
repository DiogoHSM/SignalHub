import { createHmac } from "node:crypto";
import { DUMMY_PASSWORD_HASH, type AuthLoginOutcome } from "@sigmon/telemetry/auth";
import type { AuthSessionContext, AuthUser } from "../routes/auth.js";

const accountQuotaScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

type AccountQuotaRedis = {
  eval: (script: string, numberOfKeys: number, key: string, ttlMs: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

type SourceQuotaResult = { isAllowed: boolean; isExceeded?: boolean };

export type LoginGuardErrorCode = "source_rate_limited" | "account_rate_limited" | "auth_unavailable";

export class LoginGuardError extends Error {
  readonly code: LoginGuardErrorCode;

  constructor(code: LoginGuardErrorCode) {
    super(code);
    this.name = "LoginGuardError";
    this.code = code;
  }
}

export type LoginGuardOptions = {
  sessionSecret: string;
  redis: AccountQuotaRedis;
  accountLimit?: number;
  accountWindowMs?: number;
  progressiveDelayMaxMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  recordTelemetry?: (outcome: AuthLoginOutcome) => void;
};

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class LoginGuard {
  private readonly accountLimit: number;
  private readonly accountWindowMs: number;
  private readonly progressiveDelayMaxMs: number;
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: LoginGuardOptions) {
    this.accountLimit = options.accountLimit ?? 8;
    this.accountWindowMs = options.accountWindowMs ?? 15 * 60_000;
    this.progressiveDelayMaxMs = options.progressiveDelayMaxMs ?? 2_000;
    this.delay = options.delay ?? defaultDelay;
  }

  async checkSource(check: () => Promise<SourceQuotaResult>): Promise<void> {
    let result: SourceQuotaResult;
    try {
      result = await check();
    } catch {
      this.options.recordTelemetry?.("auth_unavailable");
      throw new LoginGuardError("auth_unavailable");
    }

    if (
      typeof result?.isAllowed !== "boolean" ||
      (!result.isAllowed && typeof result.isExceeded !== "boolean")
    ) {
      this.options.recordTelemetry?.("auth_unavailable");
      throw new LoginGuardError("auth_unavailable");
    }
    if (!result.isAllowed && result.isExceeded) {
      this.options.recordTelemetry?.("source_rate_limited");
      throw new LoginGuardError("source_rate_limited");
    }
  }

  async checkAccount(email: string): Promise<number> {
    const key = this.accountKey(email);
    let rawCount: unknown;
    try {
      rawCount = await this.options.redis.eval(accountQuotaScript, 1, key, String(this.accountWindowMs));
    } catch {
      this.options.recordTelemetry?.("auth_unavailable");
      throw new LoginGuardError("auth_unavailable");
    }

    const count = typeof rawCount === "number" ? rawCount : Number.NaN;
    if (!Number.isSafeInteger(count) || count < 1) {
      this.options.recordTelemetry?.("auth_unavailable");
      throw new LoginGuardError("auth_unavailable");
    }
    if (count > this.accountLimit) {
      this.options.recordTelemetry?.("account_rate_limited");
      throw new LoginGuardError("account_rate_limited");
    }

    return count;
  }

  async recordFailure(attemptCount: number): Promise<void> {
    this.options.recordTelemetry?.("invalid_credentials");
    const exponent = Math.max(0, Math.min(30, attemptCount - 1));
    const delayMs = Math.min(this.progressiveDelayMaxMs, 100 * 2 ** exponent);
    await this.delay(delayMs);
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      const deleted = await this.options.redis.del(this.accountKey(email));
      if (!Number.isSafeInteger(deleted) || Number(deleted) < 0) {
        throw new Error("malformed Redis delete result");
      }
    } catch {
      this.options.recordTelemetry?.("auth_unavailable");
      throw new LoginGuardError("auth_unavailable");
    }
    this.options.recordTelemetry?.("success");
  }

  private accountKey(email: string): string {
    const digest = createHmac("sha256", this.options.sessionSecret)
      .update(normalizeLoginEmail(email), "utf8")
      .digest("hex");
    return `auth:login:account:${digest}`;
  }
}

export class Argon2Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("argon2_concurrency_limit_invalid");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

type GuardedLoginUser = AuthUser & {
  passwordHash: string | null;
  archivedAt?: Date | null;
};

export type GuardedLoginDependencies = {
  guard: LoginGuard;
  semaphore: Argon2Semaphore;
  findUser: (normalizedEmail: string) => Promise<GuardedLoginUser | null | undefined>;
  verifyPassword: (hash: string, password: string) => Promise<boolean>;
  createSession: (user: GuardedLoginUser, context: AuthSessionContext) => Promise<void>;
};

export function createGuardedLogin(dependencies: GuardedLoginDependencies) {
  return async (email: string, password: string, context: AuthSessionContext): Promise<AuthUser | null> => {
    const normalizedEmail = normalizeLoginEmail(email);
    const attemptCount = await dependencies.guard.checkAccount(normalizedEmail);
    const user = await dependencies.findUser(normalizedEmail);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const validPassword = await dependencies.semaphore.run(() =>
      dependencies.verifyPassword(passwordHash, password)
    );
    if (!user || user.archivedAt != null || user.passwordHash === null || !validPassword) {
      await dependencies.guard.recordFailure(attemptCount);
      return null;
    }

    await dependencies.guard.recordSuccess(normalizedEmail);
    await dependencies.createSession(user, context);
    return {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin
    };
  };
}
