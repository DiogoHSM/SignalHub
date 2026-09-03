import { Redis } from "ioredis";

const defaultConnectTimeoutMs = 500;
const defaultCommandTimeoutMs = 500;
const defaultRetryDelayMs = 100;

export type RateLimitRedisOptions = {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  socketTimeoutMs?: number;
  retryDelayMs?: number;
  onError?: (error: Error) => void;
};

export function createRateLimitRedis(redisUrl: string, options: RateLimitRedisOptions = {}): Redis {
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
  client.on("error", options.onError ?? (() => undefined));
  return client;
}

export async function closeRateLimitRedis(client: Redis): Promise<void> {
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
