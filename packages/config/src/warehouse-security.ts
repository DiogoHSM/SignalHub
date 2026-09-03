import { classifyAddress, isAddressLiteral, OutboundPolicy } from "./network-security.js";

export type WarehousePostgresTarget = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  applicationName?: string;
  ssl: false | { rejectUnauthorized: true; servername: string };
};

const applicationNamePattern = /^[A-Za-z0-9._:-]{1,64}$/;

export function parseWarehousePostgresUrl(
  rawUrl: string,
  policy: OutboundPolicy
): WarehousePostgresTarget {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("warehouse_url_invalid");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("warehouse_protocol_forbidden");
  }
  if (url.hash !== "" || hasMalformedExplicitPort(rawUrl)) {
    throw new Error("warehouse_url_invalid");
  }

  const host = stripIpv6Brackets(url.hostname).toLowerCase();
  if (host === "") {
    throw new Error("warehouse_host_required");
  }

  const database = decodeComponent(url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname);
  if (database === "" || containsControlCharacter(database)) {
    throw new Error("warehouse_database_required");
  }
  const user = decodeComponent(url.username);
  if (user === "" || containsControlCharacter(user)) {
    throw new Error("warehouse_user_required");
  }

  if (isAddressLiteral(host)) {
    try {
      policy.assertAddress(host);
    } catch {
      throw new Error("warehouse_destination_forbidden");
    }
  }

  let sslModeSeen = false;
  let applicationName: string | undefined;
  for (const [key, value] of url.searchParams) {
    if (key === "sslmode") {
      if (sslModeSeen) throw new Error("warehouse_tls_invalid");
      sslModeSeen = true;
      if (value !== "verify-full") throw new Error("warehouse_tls_required");
      continue;
    }
    if (key === "application_name") {
      if (applicationName !== undefined || !applicationNamePattern.test(value)) {
        throw new Error("warehouse_url_options_invalid");
      }
      applicationName = value;
      continue;
    }

    const normalizedKey = key.replace(/[-_.]/g, "").toLowerCase();
    if (
      normalizedKey.includes("ssl") ||
      normalizedKey.includes("tls") ||
      normalizedKey === "servername" ||
      normalizedKey === "rejectunauthorized" ||
      normalizedKey === "checkserveridentity"
    ) {
      throw new Error("warehouse_tls_invalid");
    }
    throw new Error("warehouse_url_options_invalid");
  }

  const literalLoopback = isAddressLiteral(host) && classifyAddress(host) === "loopback";
  const allowPlaintext = literalLoopback && policy.allowsLoopback();

  return {
    host,
    port: url.port === "" ? 5432 : Number(url.port),
    database,
    user,
    password: decodeComponent(url.password),
    ...(applicationName === undefined ? {} : { applicationName }),
    ssl: allowPlaintext ? false : { rejectUnauthorized: true, servername: host }
  };
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("warehouse_url_invalid");
  }
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function hasMalformedExplicitPort(rawUrl: string): boolean {
  const schemeEnd = rawUrl.indexOf("://");
  if (schemeEnd < 0) return true;
  const authorityStart = schemeEnd + 3;
  const authorityEnd = rawUrl.slice(authorityStart).search(/[/?#]/);
  const authority = authorityEnd < 0
    ? rawUrl.slice(authorityStart)
    : rawUrl.slice(authorityStart, authorityStart + authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  let rawPort: string | undefined;
  if (hostPort.startsWith("[")) {
    const bracketEnd = hostPort.indexOf("]");
    if (bracketEnd < 0) return true;
    const suffix = hostPort.slice(bracketEnd + 1);
    if (suffix === "") return false;
    if (!suffix.startsWith(":")) return true;
    rawPort = suffix.slice(1);
  } else {
    const colon = hostPort.lastIndexOf(":");
    if (colon < 0) return false;
    rawPort = hostPort.slice(colon + 1);
  }
  return rawPort === "" || !/^[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort) > 65535;
}
