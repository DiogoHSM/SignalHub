export interface Redactor {
  add(secret: string | undefined): void;
  redact(value: string): string;
  secrets(): string[];
}

const REDACTED = "[REDACTED]";

export function createRedactor(initialSecrets: Array<string | undefined>): Redactor {
  const registeredSecrets = new Set<string>();

  const redactor: Redactor = {
    add(secret) {
      if (secret) {
        registeredSecrets.add(secret);
      }
    },
    redact(value) {
      const withoutCredentials = redactUrlCredentials(value);

      return [...registeredSecrets]
        .sort((left, right) => right.length - left.length)
        .reduce((output, secret) => output.split(secret).join(REDACTED), withoutCredentials);
    },
    secrets() {
      return [...registeredSecrets];
    }
  };

  initialSecrets.forEach((secret) => redactor.add(secret));

  return redactor;
}

function redactUrlCredentials(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s]+/g, (candidate) => {
    try {
      const url = new URL(candidate);

      if (!url.username && !url.password) {
        return candidate;
      }

      return `${url.protocol}//${REDACTED}@${url.host}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return candidate;
    }
  });
}
