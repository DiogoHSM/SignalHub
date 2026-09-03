const RETRYABLE_PROPERTY = "retryable";

export function markRetryableOutboundError(error: Error): Error {
  Object.defineProperty(error, RETRYABLE_PROPERTY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return error;
}

export function isRetryableOutboundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, RETRYABLE_PROPERTY);
  return (
    descriptor?.value === true &&
    descriptor.enumerable === false &&
    descriptor.configurable === false &&
    descriptor.writable === false
  );
}
