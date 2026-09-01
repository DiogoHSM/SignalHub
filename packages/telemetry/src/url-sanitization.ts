const URL_SANITIZER_BASE = "https://sigmon.invalid";
const ABSOLUTE_URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function sanitizeTelemetryUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value, URL_SANITIZER_BASE);
    for (const key of new Set(url.searchParams.keys())) {
      url.searchParams.set(key, "[REDACTED]");
    }
    url.hash = "";

    if (ABSOLUTE_URL_SCHEME.test(value)) {
      return url.toString();
    }

    const delimiterIndex = value.search(/[?#]/);
    const prefix = delimiterIndex === -1 ? value : value.slice(0, delimiterIndex);
    return `${prefix}${url.search}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}
