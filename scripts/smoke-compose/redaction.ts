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
  return value.replace(/\bhttps?:\/\/[^\s]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      const scheme = candidate.slice(0, candidate.indexOf(":"));

      if (!url.username && !url.password) {
        return candidate;
      }

      return `${scheme}://${REDACTED}@${url.host}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return candidate;
    }
  });
}
