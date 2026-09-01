import { Redis } from "ioredis";

const defaultConnectTimeoutMs = 500;
const defaultCommandTimeoutMs = 500;
const defaultRetryDelayMs = 100;

export type AuthQuotaRedisOptions = {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  socketTimeoutMs?: number;
  retryDelayMs?: number;
  onError?: (error: Error) => void;
};

export type AuthQuotaRedis = {
  eval: (script: string, numberOfKeys: number, key: string, ttlMs: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  close: () => Promise<void>;
};

export function createAuthQuotaRedis(redisUrl: string, options: AuthQuotaRedisOptions = {}): AuthQuotaRedis {
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const client = new Redis(redisUrl, {
    connectTimeout: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    commandTimeout: commandTimeoutMs,
    socketTimeout: options.socketTimeoutMs ?? commandTimeoutMs,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    retryStrategy: () => retryDelayMs
  });
  const onError = options.onError ?? (() => undefined);
  client.on("error", onError);

  return {
    eval: (script, numberOfKeys, key, ttlMs) => client.eval(script, numberOfKeys, key, ttlMs),
    del: (key) => client.del(key),
    close: async () => {
      if (client.status === "ready") {
        try {
          await client.quit();
          return;
        } catch {
          // Fall through to a hard disconnect so shutdown remains bounded during an outage.
        }
      }
      client.disconnect();
    }
  };
}
