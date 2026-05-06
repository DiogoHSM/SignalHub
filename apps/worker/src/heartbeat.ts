export const workerHeartbeatIntervalMs = 30_000;

export function startHeartbeat(input: {
  beat: () => Promise<void>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}) {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;

  const send = () => {
    void input.beat().catch((error) => {
      console.error("Worker heartbeat failed", error);
    });
  };

  send();
  const interval = setIntervalFn(send, workerHeartbeatIntervalMs);

  return () => clearIntervalFn(interval);
}
