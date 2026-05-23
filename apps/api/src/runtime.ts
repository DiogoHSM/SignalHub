export type ShutdownStep = {
  name: string;
  run: () => Promise<unknown>;
};

type RuntimeLogger = {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
};

function createShutdownTimeoutError(stepName: string, timeoutMs: number): Error {
  return new Error(`Shutdown step ${stepName} timed out after ${timeoutMs}ms`);
}

async function runStepWithTimeout(step: ShutdownStep, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(createShutdownTimeoutError(step.name, timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([step.run(), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function runShutdownSteps(
  steps: ShutdownStep[],
  timeoutMs: number,
  logger?: RuntimeLogger
): Promise<void> {
  const failures: unknown[] = [];

  for (const step of steps) {
    try {
      await runStepWithTimeout(step, timeoutMs);
    } catch (error) {
      failures.push(error);
      logger?.error({ step: step.name, error }, "Shutdown step failed");
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more shutdown steps failed");
  }
}

export async function listenWithCleanup({
  listen,
  cleanup,
  logger
}: {
  listen: () => Promise<unknown>;
  cleanup: () => Promise<unknown>;
  logger: RuntimeLogger;
}): Promise<void> {
  try {
    await listen();
  } catch (error) {
    logger.error({ error }, "API listen failed");
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.error({ error: cleanupError }, "API listen cleanup failed");
    }
    throw error;
  }
}

export async function runSignalShutdown({
  shutdown,
  logger,
  failureMessage,
  exit = process.exit
}: {
  shutdown: () => Promise<unknown>;
  logger: RuntimeLogger;
  failureMessage: string;
  exit?: (code: number) => unknown;
}): Promise<void> {
  try {
    await shutdown();
  } catch (error) {
    logger.error({ error }, failureMessage);
  } finally {
    exit(0);
  }
}
