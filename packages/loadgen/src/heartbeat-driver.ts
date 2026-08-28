export type HeartbeatDriverOptions = {
  endpoint: string;
  monitorId: string;
  monitorSecret: string;
  intervalMs: number;
  isInOutageWindow: (nowMs: number) => boolean;
  fetchImpl?: typeof fetch;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
};

export function startHeartbeatDriver(options: HeartbeatDriverOptions): { stop: () => void } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;

  const tick = async (): Promise<void> => {
    if (options.isInOutageWindow(Date.now())) {
      return;
    }

    try {
      await fetchImpl(`${options.endpoint.replace(/\/+$/, "")}/v1/heartbeats/${options.monitorId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.monitorSecret}` }
      });
    } catch {
      // A missed heartbeat call during a transient network error is acceptable — the next tick retries,
      // and a genuinely missed window is indistinguishable from a real outage from Sigmon's point of view.
    }
  };

  const handle = setIntervalImpl(() => {
    void tick();
  }, options.intervalMs);

  return {
    stop: () => clearIntervalImpl(handle)
  };
}
