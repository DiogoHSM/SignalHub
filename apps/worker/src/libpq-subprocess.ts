const ALLOWED_PARAMETERS = new Set([
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "connect_timeout",
  "application_name"
]);
const SSL_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);
const MAX_CONNECT_TIMEOUT_SECONDS = 300;

const PARAMETER_ENV_NAMES: Record<string, string> = {
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  connect_timeout: "PGCONNECT_TIMEOUT",
  application_name: "PGAPPNAME"
};

export type LibpqSubprocessDescriptor = {
  argsConnection: string;
  env: NodeJS.ProcessEnv;
  safeLabel: string;
};

export function buildLibpqSubprocess(
  databaseUrl: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): LibpqSubprocessDescriptor {
  if (!/^(?:postgres|postgresql):\/\//.test(databaseUrl) || databaseUrl.includes("#") || databaseUrl.includes("\0")) {
    throw invalidDatabaseUrl();
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw invalidDatabaseUrl();
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw invalidDatabaseUrl();
  }

  const schemeEnd = databaseUrl.indexOf("://") + 3;
  const authorityEndOffset = databaseUrl.slice(schemeEnd).search(/[/?#]/);
  if (authorityEndOffset < 0) throw invalidDatabaseUrl();
  const authorityEnd = schemeEnd + authorityEndOffset;
  const rawAuthority = databaseUrl.slice(schemeEnd, authorityEnd);
  const lastAt = rawAuthority.lastIndexOf("@");
  if (lastAt !== rawAuthority.indexOf("@")) throw invalidDatabaseUrl();
  const rawHostPort = rawAuthority.slice(lastAt + 1);
  if (rawHostPort === "" || rawHostPort.includes(",")) throw invalidDatabaseUrl();

  const { host, port, isIpv6 } = parseHostAndPort(rawHostPort);
  const username = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);

  const pathAndQuery = databaseUrl.slice(authorityEnd);
  const queryOffset = pathAndQuery.indexOf("?");
  const rawPath = queryOffset < 0 ? pathAndQuery : pathAndQuery.slice(0, queryOffset);
  const rawQuery = queryOffset < 0 ? "" : pathAndQuery.slice(queryOffset + 1);
  if (!rawPath.startsWith("/") || rawPath.length === 1 || rawPath.slice(1).includes("/")) {
    throw invalidDatabaseUrl();
  }
  const databaseName = decodeUrlComponent(rawPath.slice(1));
  if (databaseName === "") throw invalidDatabaseUrl();

  const parameters = parseParameters(rawQuery);
  const env = scrubPgEnvironment(baseEnv);
  env.PGHOST = host;
  if (port !== undefined) env.PGPORT = port;
  if (username !== "") env.PGUSER = username;
  if (password !== "") env.PGPASSWORD = password;
  for (const [key, value] of parameters) {
    env[PARAMETER_ENV_NAMES[key]!] = value;
  }

  const displayHost = isIpv6 ? `[${host}]` : host;
  return {
    argsConnection: `dbname='${escapeConninfoValue(databaseName)}'`,
    env,
    safeLabel: `${displayHost}${port === undefined ? "" : `:${port}`}/${databaseName}`
  };
}

function parseHostAndPort(rawHostPort: string): { host: string; port?: string; isIpv6: boolean } {
  let rawHost: string;
  let rawPort: string | undefined;
  let isIpv6 = false;

  if (rawHostPort.startsWith("[")) {
    const close = rawHostPort.indexOf("]");
    if (close <= 1) throw invalidDatabaseUrl();
    rawHost = rawHostPort.slice(1, close);
    const suffix = rawHostPort.slice(close + 1);
    if (suffix !== "") {
      if (!suffix.startsWith(":")) throw invalidDatabaseUrl();
      rawPort = suffix.slice(1);
    }
    isIpv6 = true;
  } else {
    const colon = rawHostPort.lastIndexOf(":");
    if (colon >= 0) {
      rawHost = rawHostPort.slice(0, colon);
      rawPort = rawHostPort.slice(colon + 1);
    } else {
      rawHost = rawHostPort;
    }
  }

  if (rawHost === "" || rawHost.includes(",")) throw invalidDatabaseUrl();
  if (rawPort !== undefined && (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65_535)) {
    throw invalidDatabaseUrl();
  }

  if (isIpv6) {
    if (rawHost.includes("%")) throw invalidDatabaseUrl();
    return { host: rawHost.toLowerCase(), ...(rawPort === undefined ? {} : { port: rawPort }), isIpv6 };
  }

  if (rawHost.includes("%")) {
    if (!/^%2f/i.test(rawHost) || rawPort !== undefined) throw invalidDatabaseUrl();
    const socketPath = decodeUrlComponent(rawHost);
    if (!socketPath.startsWith("/") || socketPath.includes(",")) throw invalidDatabaseUrl();
    return { host: socketPath, isIpv6: false };
  }

  return { host: rawHost.toLowerCase(), ...(rawPort === undefined ? {} : { port: rawPort }), isIpv6: false };
}

function parseParameters(rawQuery: string): Map<string, string> {
  const parameters = new Map<string, string>();
  if (rawQuery === "") return parameters;

  for (const pair of rawQuery.split("&")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) throw invalidDatabaseUrl();
    const key = pair.slice(0, separator);
    const rawValue = pair.slice(separator + 1);
    if (!ALLOWED_PARAMETERS.has(key) || parameters.has(key)) throw invalidDatabaseUrl();
    const value = decodeUrlComponent(rawValue);

    if (key === "sslmode" && !SSL_MODES.has(value)) throw invalidDatabaseUrl();
    if (
      key === "connect_timeout" &&
      (!/^[1-9][0-9]*$/.test(value) || Number(value) > MAX_CONNECT_TIMEOUT_SECONDS)
    ) {
      throw invalidDatabaseUrl();
    }
    if ((key === "sslrootcert" || key === "sslcert" || key === "sslkey") && value === "") {
      throw invalidDatabaseUrl();
    }

    parameters.set(key, value);
  }

  return parameters;
}

function decodeUrlComponent(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw invalidDatabaseUrl();
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) throw invalidDatabaseUrl();
  return decoded;
}

function scrubPgEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!/^pg/i.test(key)) env[key] = value;
  }
  return env;
}

function escapeConninfoValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function invalidDatabaseUrl(): Error {
  return new Error("database_url_invalid");
}
