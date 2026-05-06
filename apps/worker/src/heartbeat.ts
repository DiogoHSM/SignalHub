export const workerHeartbeatIntervalMs = 30_000;

export function startHeartbeat(input: {
  beat: () => Promise<void>;
  setIntervalFn?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}): () => Promise<void> {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  let stopped = false;
  let activeBeat: Promise<void> | null = null;

  const send = () => {
    if (stopped || activeBeat) return;
    activeBeat = input
      .beat()
      .catch((error) => {
        console.error("Worker heartbeat failed", error);
      })
      .finally(() => {
        activeBeat = null;
      });
  };

  send();
  const interval = setIntervalFn(send, workerHeartbeatIntervalMs);

  return async () => {
    stopped = true;
    clearIntervalFn(interval);
    await activeBeat;
  };
}
